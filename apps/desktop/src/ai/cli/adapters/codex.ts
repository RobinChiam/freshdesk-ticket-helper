/**
 * OpenAI Codex CLI adapter.
 * Sensitive prompt content is supplied only via stdin (`codex exec … -`).
 */
import type { CliAdapterId } from '@fth/protocol';

import { classifyCliFailure } from '../errors.js';
import { createCodexJsonlParser } from '../parsers/codexJsonl.js';
import {
  CliAdapterError,
  DEFAULT_CLI_LIMITS,
  type CliLimits,
  type ProcessRunner,
  type CliStreamHandlers,
} from '../types.js';

export const CODEX_STATIC_STDIN_SENTINEL = '-';

/** Flags verified against `codex exec --help` and OpenAI non-interactive docs. */
export function buildCodexExecArgs(options: { workdir: string; modelId?: string }): string[] {
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '-C',
    options.workdir,
  ];
  const model = options.modelId?.trim();
  if (model) {
    args.push('-m', model);
  }
  // Full prompt through stdin — never place ticket content in argv.
  args.push(CODEX_STATIC_STDIN_SENTINEL);
  return args;
}

export function buildCodexVersionArgs(): string[] {
  return ['--version'];
}

export function buildCodexLoginStatusArgs(): string[] {
  return ['login', 'status'];
}

export async function runCodexStream(options: {
  executable: string;
  workdir: string;
  modelId: string;
  stdin: string;
  env: NodeJS.ProcessEnv;
  runner: ProcessRunner;
  handlers: CliStreamHandlers;
  limits?: CliLimits;
}): Promise<string> {
  const limits = options.limits ?? DEFAULT_CLI_LIMITS;
  const parser = createCodexJsonlParser(limits);
  const result = await options.runner({
    executable: options.executable,
    args: buildCodexExecArgs({ workdir: options.workdir, modelId: options.modelId }),
    cwd: options.workdir,
    env: options.env,
    stdin: options.stdin,
    signal: options.handlers.signal,
    limits,
    onStdoutChunk: (chunk) => {
      const delta = parser.push(chunk);
      if (delta) options.handlers.onDelta(delta);
    },
  });

  if (options.handlers.signal.aborted) {
    throw new CliAdapterError('cancelled', 'The AI request was cancelled.');
  }

  try {
    parser.finish();
  } catch (error) {
    if (error instanceof CliAdapterError) throw error;
    throw new CliAdapterError('malformed_output', 'The provider CLI returned malformed output.');
  }

  if (result.timedOut || result.startupTimedOut || result.exitCode !== 0) {
    throw classifyCliFailure({
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: '',
      timedOut: result.timedOut,
      startupTimedOut: result.startupTimedOut,
      aborted: options.handlers.signal.aborted,
    });
  }

  const text = parser.getState().text.trim();
  if (!text) {
    throw new CliAdapterError('provider_error', 'The provider CLI returned an empty response.');
  }
  return text;
}

export async function interpretCodexAuthStatus(
  stdout: string,
  exitCode: number | null,
): Promise<'ready' | 'login_required'> {
  if (exitCode !== 0) return 'login_required';
  if (/not\s+logged\s+in|logged\s+out/i.test(stdout)) return 'login_required';
  if (/logged\s+in/i.test(stdout)) return 'ready';
  return exitCode === 0 ? 'ready' : 'login_required';
}

export const CODEX_ADAPTER_ID: CliAdapterId = 'codex';
