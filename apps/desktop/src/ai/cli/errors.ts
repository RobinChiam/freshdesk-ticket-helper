/**
 * Map CLI failures to safe user-facing categories.
 * Never return raw paths, tokens, stack traces, or provider diagnostics.
 */
import { CliAdapterError, type CliErrorCode } from './types.js';

export function classifyCliFailure(input: {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
  startupTimedOut: boolean;
  aborted: boolean;
}): CliAdapterError {
  if (input.aborted) {
    return new CliAdapterError('cancelled', 'The AI request was cancelled.');
  }
  if (input.startupTimedOut) {
    return new CliAdapterError(
      'timeout',
      'The provider CLI did not start responding before the startup timeout.',
    );
  }
  if (input.timedOut) {
    return new CliAdapterError('timeout', 'The provider CLI did not finish before the timeout.');
  }

  const haystack = `${input.stderr}\n${input.stdout}`.toLowerCase();

  if (
    /not\s+logged\s+in|login\s+required|unauthoriz|authentication required|please\s+run\s+.*login|auth[_\s-]?status.*false|loggedOut|not authenticated/i.test(
      haystack,
    )
  ) {
    return new CliAdapterError(
      'not_authenticated',
      'The provider CLI is not authenticated. Open a terminal and sign in with the provider CLI, then try again.',
    );
  }
  if (/token\s+expired|session\s+expired|refresh.*(fail|error)|re-?auth/i.test(haystack)) {
    return new CliAdapterError(
      'authentication_expired',
      'The provider CLI login has expired. Open a terminal and re-authenticate with the provider CLI.',
    );
  }
  if (/open.*(browser|url)|visit\s+https?:\/\/|device\s+code|oauth/i.test(haystack)) {
    return new CliAdapterError(
      'browser_login_required',
      'The provider CLI requires an interactive browser login. Complete authentication in a terminal, then retry.',
    );
  }
  if (/rate\s*limit|quota|too many requests|usage limit|credit/i.test(haystack)) {
    return new CliAdapterError(
      'rate_limited',
      'The provider rate limit or quota was reached. Try again later.',
    );
  }
  if (/unknown model|model .* not (found|available)|unsupported model/i.test(haystack)) {
    return new CliAdapterError(
      'unsupported_model',
      'The configured model is not supported by the installed provider CLI.',
    );
  }
  if (/unknown option|unrecognized|invalid (flag|option)|unexpected argument/i.test(haystack)) {
    return new CliAdapterError(
      'unsupported_version',
      'The installed provider CLI version does not support the required automation flags.',
    );
  }
  if (input.exitCode === null) {
    return new CliAdapterError('process_terminated', 'The provider CLI process was terminated.');
  }
  return new CliAdapterError(
    'provider_error',
    'The provider CLI request failed. Check installation, authentication, and try again.',
  );
}

export function sanitizeCliError(error: unknown): { code: string; error: string } {
  if (error instanceof CliAdapterError) {
    return { code: error.code, error: error.message };
  }
  if (error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message))) {
    return { code: 'cancelled', error: 'The AI request was cancelled.' };
  }
  return {
    code: 'provider_error' satisfies CliErrorCode,
    error: 'The AI request failed. Check the provider connection and try again.',
  };
}
