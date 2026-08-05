/**
 * Safe child-process runner: argument arrays only, shell:false, stdin for secrets.
 * Never constructs a shell command string.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { terminateProcessTree } from './processTree.js';
import {
  CliAdapterError,
  type ProcessRunner,
  type SpawnRequest,
  type SpawnResult,
} from './types.js';

export const createNodeProcessRunner = (): ProcessRunner => {
  return (request) => runProcess(request);
};

export function runProcess(request: SpawnRequest): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let startupTimedOut = false;
    let sawStdout = false;
    let child: ChildProcessWithoutNullStreams;

    const finish = (result: SpawnResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      clearTimeout(totalTimer);
      resolve(result);
    };

    const failLimit = (message: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      clearTimeout(totalTimer);
      terminateProcessTree(child);
      reject(new CliAdapterError('output_limit_exceeded', message));
    };

    try {
      // shell:false is mandatory — never pass a command string or enable a shell.
      child = spawn(request.executable, request.args, {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        windowsHide: true,
        // Detached on Unix so we can signal the whole process group on cancel/timeout.
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      reject(
        new CliAdapterError(
          'cli_missing',
          'The provider CLI could not be started. Check the installation and try again.',
        ),
      );
      return;
    }

    const startupTimer = setTimeout(() => {
      if (sawStdout || settled) return;
      startupTimedOut = true;
      terminateProcessTree(child);
    }, request.limits.startupTimeoutMs);

    const totalTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      terminateProcessTree(child);
    }, request.limits.totalTimeoutMs);

    const onAbort = (): void => {
      terminateProcessTree(child);
    };
    if (request.signal.aborted) {
      onAbort();
    } else {
      request.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      sawStdout = true;
      clearTimeout(startupTimer);
      const bytes = Buffer.byteLength(chunk, 'utf8');
      stdoutBytes += bytes;
      if (stdoutBytes > request.limits.maxStdoutBytes) {
        failLimit('The provider CLI produced more output than allowed.');
        return;
      }
      stdout += chunk;
      request.onStdoutChunk?.(chunk);
    });

    child.stderr.on('data', (chunk: string) => {
      const bytes = Buffer.byteLength(chunk, 'utf8');
      stderrBytes += bytes;
      if (stderrBytes > request.limits.maxStderrBytes) {
        failLimit('The provider CLI produced more diagnostic output than allowed.');
        return;
      }
      // Keep stderr for error classification only — never log raw content.
      if (stderr.length < request.limits.maxStderrBytes) {
        stderr += chunk;
      }
    });

    child.on('error', () => {
      request.signal.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      clearTimeout(totalTimer);
      reject(
        new CliAdapterError(
          'cli_missing',
          'The provider CLI could not be started. Check the installation and try again.',
        ),
      );
    });

    child.on('close', (exitCode, signal) => {
      request.signal.removeEventListener('abort', onAbort);
      finish({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        startupTimedOut,
      });
    });

    // Sensitive ticket/prompt content goes through stdin only — never argv.
    try {
      child.stdin.end(request.stdin, 'utf8');
    } catch {
      terminateProcessTree(child);
    }
  });
}
