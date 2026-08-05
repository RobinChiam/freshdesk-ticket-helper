import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, streamText, type LanguageModel } from 'ai';

import { logicalProviderForAdapter, type AiProviderId, type CliAdapterId } from '@fth/protocol';

import {
  CliProviderRuntime,
  sanitizeCliError,
  type SubscriptionCliConfig,
} from './cli/cliProviderRuntime.js';
import { CliAdapterError } from './cli/types.js';
import type { PromptMessage } from './prompt.js';

export type ApiKeyProviderConfig = {
  kind: 'api-key';
  providerId: AiProviderId;
  modelId: string;
  customBaseUrl: string;
  apiKey: string;
};

export type ProviderConfig = ApiKeyProviderConfig | SubscriptionCliConfig;

export type StreamRequest = ProviderConfig & {
  system: string;
  messages: PromptMessage[];
  signal: AbortSignal;
};

export interface ProviderRuntime {
  stream(request: StreamRequest): AsyncIterable<string>;
  test(config: ProviderConfig): Promise<void>;
}

export class AiSdkProviderRuntime {
  async *stream(
    request: ApiKeyProviderConfig & {
      system: string;
      messages: PromptMessage[];
      signal: AbortSignal;
    },
  ): AsyncIterable<string> {
    const result = streamText({
      model: createModel(request),
      system: request.system,
      messages: request.messages,
      abortSignal: request.signal,
      maxRetries: 1,
      maxOutputTokens: 2_048,
      timeout: { totalMs: 90_000, firstChunkMs: 30_000, chunkMs: 30_000 },
    });
    for await (const chunk of result.textStream) yield chunk;
  }

  async test(config: ApiKeyProviderConfig): Promise<void> {
    await generateText({
      model: createModel(config),
      prompt: 'Reply with OK.',
      maxRetries: 0,
      maxOutputTokens: 8,
      timeout: { totalMs: 20_000 },
    });
  }
}

/** Routes API-key and subscription-CLI connections behind one streaming interface. */
export class CompositeProviderRuntime implements ProviderRuntime {
  private readonly apiKeyRuntime: AiSdkProviderRuntime;
  private readonly cliRuntime: CliProviderRuntime;

  constructor(options?: { apiKeyRuntime?: AiSdkProviderRuntime; cliRuntime?: CliProviderRuntime }) {
    this.apiKeyRuntime = options?.apiKeyRuntime ?? new AiSdkProviderRuntime();
    this.cliRuntime = options?.cliRuntime ?? new CliProviderRuntime();
  }

  async *stream(request: StreamRequest): AsyncIterable<string> {
    if (request.kind === 'api-key') {
      yield* this.apiKeyRuntime.stream(request);
      return;
    }
    yield* this.cliRuntime.stream(request);
  }

  async test(config: ProviderConfig): Promise<void> {
    if (config.kind === 'api-key') {
      await this.apiKeyRuntime.test(config);
      return;
    }
    await this.cliRuntime.test(config);
  }
}

function createModel(config: ApiKeyProviderConfig): LanguageModel {
  switch (config.providerId) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.modelId);
    case 'openai':
      return createOpenAI({ apiKey: config.apiKey })(config.modelId);
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey })(config.modelId);
    case 'openai-compatible':
      return createOpenAICompatible({
        name: 'custom-openai-compatible',
        baseURL: config.customBaseUrl,
        apiKey: config.apiKey,
      })(config.modelId);
  }
}

/** Map provider failures to safe user-facing categories without echoing response bodies or keys. */
export function sanitizeProviderError(error: unknown): { code: string; error: string } {
  if (error instanceof CliAdapterError) {
    return sanitizeCliError(error);
  }
  if (error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message))) {
    return { code: 'cancelled', error: 'The AI request was cancelled.' };
  }
  const statusCode = readStatusCode(error);
  if (statusCode === 401 || statusCode === 403) {
    return {
      code: 'authentication_failed',
      error: 'The provider rejected the API key or account permissions.',
    };
  }
  if (statusCode === 404) {
    return {
      code: 'model_not_found',
      error: 'The configured model or provider endpoint was not found.',
    };
  }
  if (statusCode === 429) {
    return {
      code: 'rate_limited',
      error: 'The provider rate limit or quota was reached. Try again later.',
    };
  }
  if (statusCode && statusCode >= 500) {
    return { code: 'provider_unavailable', error: 'The AI provider is temporarily unavailable.' };
  }
  if (error instanceof Error && /timeout|timed out/i.test(error.message)) {
    return { code: 'timeout', error: 'The AI provider did not respond before the timeout.' };
  }
  return {
    code: 'provider_error',
    error: 'The AI request failed. Check the provider, model, and network settings.',
  };
}

function readStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { statusCode?: unknown; status?: unknown };
  const value = candidate.statusCode ?? candidate.status;
  return typeof value === 'number' ? value : null;
}

export function logicalProviderId(config: ProviderConfig): AiProviderId {
  return config.kind === 'api-key' ? config.providerId : config.logicalProviderId;
}

export function cliAdapterIdOf(config: ProviderConfig): CliAdapterId | undefined {
  return config.kind === 'subscription-cli' ? config.adapter : undefined;
}

export { logicalProviderForAdapter };
