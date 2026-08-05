/**
 * Isolated empty working directories for CLI invocations.
 * Never run provider CLIs in the app repo or the user's current project.
 */
import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export type TempWorkdir = {
  path: string;
  cleanup: () => void;
};

export function createIsolatedWorkdir(prefix = 'fth-cli-'): TempWorkdir {
  const path = resolve(mkdtempSync(join(tmpdir(), prefix)));
  try {
    // Restrictive permissions where supported (no-op / ignored on some Windows setups).
    chmodSync(path, 0o700);
  } catch {
    // Best-effort only.
  }

  return {
    path,
    cleanup: () => {
      // Remove only this exact temporary directory — never a broad recursive target.
      rmSync(path, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
