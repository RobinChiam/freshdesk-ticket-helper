/**
 * Process runner unit tests — spawn is mocked; real CLIs are never executed.
 */
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runProcess } from '../src/ai/cli/processRunner';
import { DEFAULT_CLI_LIMITS } from '../src/ai/cli/types';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFile: vi.fn(),
}));

function mockChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdin: { end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = 4242;
  child.stdin = { end: vi.fn() };
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.kill = vi.fn();
  return child;
}

afterEach(() => {
  spawnMock.mockReset();
});

describe('runProcess', () => {
  it('spawns with shell:false and writes sensitive stdin', async () => {
    const child = mockChild();
    spawnMock.mockReturnValue(child);

    const promise = runProcess({
      executable: '/usr/local/bin/codex',
      args: ['exec', '-'],
      cwd: '/tmp/workdir',
      env: { PATH: '/usr/bin' },
      stdin: 'SECRET_TICKET',
      signal: new AbortController().signal,
      limits: DEFAULT_CLI_LIMITS,
    });

    queueMicrotask(() => {
      child.stdout.emit('data', 'ok\n');
      child.emit('close', 0, null);
    });

    const result = await promise;
    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/local/bin/codex',
      ['exec', '-'],
      expect.objectContaining({
        shell: false,
        cwd: '/tmp/workdir',
        windowsHide: true,
      }),
    );
    expect(child.stdin.end).toHaveBeenCalledWith('SECRET_TICKET', 'utf8');
    expect(result.exitCode).toBe(0);
  });

  it('aborts and rejects when stdout exceeds the byte limit', async () => {
    const child = mockChild();
    spawnMock.mockReturnValue(child);
    const promise = runProcess({
      executable: '/bin/tool',
      args: ['x'],
      cwd: '/tmp',
      env: {},
      stdin: '',
      signal: new AbortController().signal,
      limits: { ...DEFAULT_CLI_LIMITS, maxStdoutBytes: 8 },
    });
    queueMicrotask(() => {
      child.stdout.emit('data', '0123456789');
    });
    await expect(promise).rejects.toThrow(/more output than allowed/i);
  });
});
