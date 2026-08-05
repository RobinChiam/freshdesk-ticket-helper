/**
 * Subscription-CLI adapter contracts.
 * Logical provider identity stays separate from CLI executable / adapter IDs.
 */
import type { CliAdapterId } from '@fth/protocol';

export type CliLimits = {
  startupTimeoutMs: number;
  totalTimeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxJsonlLineBytes: number;
  maxResponseChars: number;
};

export const DEFAULT_CLI_LIMITS: CliLimits = {
  startupTimeoutMs: 30_000,
  totalTimeoutMs: 90_000,
  maxStdoutBytes: 2_000_000,
  maxStderrBytes: 256_000,
  maxJsonlLineBytes: 1_024_000,
  maxResponseChars: 500_000,
};

export type CliErrorCode =
  | 'cli_missing'
  | 'unsupported_version'
  | 'not_authenticated'
  | 'authentication_expired'
  | 'browser_login_required'
  | 'rate_limited'
  | 'unsupported_model'
  | 'malformed_output'
  | 'timeout'
  | 'process_terminated'
  | 'output_limit_exceeded'
  | 'secure_automation_unsupported'
  | 'security_violation'
  | 'provider_error'
  | 'cancelled';

export class CliAdapterError extends Error {
  readonly code: CliErrorCode;

  constructor(code: CliErrorCode, message: string) {
    super(message);
    this.name = 'CliAdapterError';
    this.code = code;
  }
}

export type SpawnRequest = {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  signal: AbortSignal;
  limits: CliLimits;
  /** Called for each decoded stdout UTF-8 chunk before adapter-specific parsing. */
  onStdoutChunk?: (chunk: string) => void;
};

export type SpawnResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  startupTimedOut: boolean;
};

/**
 * Injectable process runner — production uses Node child_process with shell:false.
 * Tests inject fakes; never invoke real provider CLIs in unit tests.
 */
export type ProcessRunner = (request: SpawnRequest) => Promise<SpawnResult>;

export type AdapterExecutableNames = {
  unix: string[];
  windows: string[];
};

export type CliAdapterDefinition = {
  id: CliAdapterId;
  displayName: string;
  executableNames: AdapterExecutableNames;
  /** Documented per-user install candidates (before PATH lookup). */
  candidateDirectories: (home: string, platform: NodeJS.Platform) => string[];
};

export type StreamParseResult = {
  text: string;
  /** True when a documented terminal success event was observed. */
  completed: boolean;
};

export type CliStreamHandlers = {
  onDelta: (text: string) => void;
  signal: AbortSignal;
};
