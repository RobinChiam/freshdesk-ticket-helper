/**
 * Terminate a child process and its descendants without shell command strings.
 * Uses process-group signals on Unix and taskkill.exe via execFile on Windows.
 */
import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export function terminateProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform,
): void {
  const pid = child.pid;
  if (!pid) return;

  if (platform === 'win32') {
    // Argument array + shell:false — never cmd.exe /c or PowerShell.
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      shell: false,
    });
    return;
  }

  try {
    // Negative PID targets the process group created when spawn({ detached: true }).
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // Already exited.
    }
  }

  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already exited.
      }
    }
  }, 1_500).unref?.();
}
