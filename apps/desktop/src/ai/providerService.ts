import { randomUUID } from 'node:crypto';

import type { ChatEvent, ChatHistoryMessage, ChatSendInput } from '@fth/protocol';

import type { AppDatabase } from '../database/index.js';
import { buildPromptMessages, SYSTEM_INSTRUCTIONS } from './prompt.js';
import {
  cliAdapterIdOf,
  CompositeProviderRuntime,
  logicalProviderId,
  sanitizeProviderError,
  type ProviderConfig,
  type ProviderRuntime,
} from './providerRuntime.js';

export type ProviderServiceOptions = {
  db: AppDatabase;
  onEvent: (event: ChatEvent) => void;
  runtime?: ProviderRuntime;
};

export class AiProviderService {
  private readonly active = new Map<string, AbortController>();
  private readonly recentClientKeys = new Set<string>();
  private readonly recentClientKeyOrder: string[] = [];
  private readonly runtime: ProviderRuntime;

  constructor(private readonly options: ProviderServiceOptions) {
    this.runtime = options.runtime ?? new CompositeProviderRuntime();
  }

  start(
    input: ChatSendInput,
    config: ProviderConfig,
    sanitizedQuestion: string,
  ): { requestId: string } {
    if (this.recentClientKeys.has(input.clientRequestKey)) {
      throw new Error('This chat request was already submitted.');
    }
    this.rememberClientKey(input.clientRequestKey);

    const history = this.options.db.listChatMessages(input.ticketKey, 200);
    const requestId = randomUUID();
    const controller = new AbortController();
    this.active.set(requestId, controller);

    this.options.db.appendChatMessage(this.newMessage(input, config, 'user', sanitizedQuestion));
    // Defer provider work so IPC can return requestId before the first streamed event.
    setImmediate(
      () => void this.run(requestId, input, config, sanitizedQuestion, history, controller),
    );
    return { requestId };
  }

  cancel(requestId: string): boolean {
    const controller = this.active.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const controller of this.active.values()) controller.abort();
  }

  async test(config: ProviderConfig): Promise<void> {
    await this.runtime.test(config);
  }

  private async run(
    requestId: string,
    input: ChatSendInput,
    config: ProviderConfig,
    question: string,
    history: ChatHistoryMessage[],
    controller: AbortController,
  ): Promise<void> {
    this.emit({ type: 'started', requestId, ticketKey: input.ticketKey });
    let text = '';
    let sequence = 0;
    try {
      const messages = buildPromptMessages(input.sanitizedContext, history, question);
      for await (const delta of this.runtime.stream({
        ...config,
        system: SYSTEM_INSTRUCTIONS,
        messages,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        text += delta;
        this.emit({ type: 'delta', requestId, ticketKey: input.ticketKey, sequence, text: delta });
        sequence += 1;
      }
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!text.trim()) throw new Error('Provider returned an empty response.');
      this.options.db.appendChatMessage(this.newMessage(input, config, 'assistant', text));
      this.emit({ type: 'completed', requestId, ticketKey: input.ticketKey, text });
    } catch (error) {
      const safe = sanitizeProviderError(error);
      if (controller.signal.aborted || safe.code === 'cancelled') {
        this.emit({ type: 'cancelled', requestId, ticketKey: input.ticketKey });
      } else {
        this.emit({ type: 'failed', requestId, ticketKey: input.ticketKey, ...safe });
      }
    } finally {
      this.active.delete(requestId);
    }
  }

  private newMessage(
    input: ChatSendInput,
    config: ProviderConfig,
    role: 'user' | 'assistant',
    text: string,
  ): ChatHistoryMessage {
    const adapter = cliAdapterIdOf(config);
    return {
      id: randomUUID(),
      ticketKey: input.ticketKey,
      role,
      text,
      providerId: logicalProviderId(config),
      modelId: config.modelId,
      connectionKind: config.kind,
      ...(adapter ? { cliAdapterId: adapter } : {}),
      contextRevision: input.contextRevision,
      createdAt: new Date().toISOString(),
    };
  }

  private emit(event: ChatEvent): void {
    this.options.onEvent(event);
  }

  private rememberClientKey(key: string): void {
    this.recentClientKeys.add(key);
    this.recentClientKeyOrder.push(key);
    if (this.recentClientKeyOrder.length <= 1_000) return;
    const oldest = this.recentClientKeyOrder.shift();
    if (oldest) this.recentClientKeys.delete(oldest);
  }
}
