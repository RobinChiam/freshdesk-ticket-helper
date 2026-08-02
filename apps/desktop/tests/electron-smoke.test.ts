/**
 * Vitest wrapper that launches the built Electron app main entry in smoke mode.
 * Covers packaged-style file:// renderer load with sandbox + real IPC handlers.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const electronBinary = require('electron') as string;
const mainEntry = path.join(desktopRoot, 'out/main/index.js');

describe('electron startup smoke', () => {
  it('loads preload, exposes desktopApi, and mounts React into #root', async () => {
    expect(existsSync(mainEntry)).toBe(true);

    const dir = mkdtempSync(path.join(tmpdir(), 'fth-smoke-'));
    const resultPath = path.join(dir, 'result.json');

    const { exitCode, stdout, stderr } = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(electronBinary, [mainEntry], {
        cwd: desktopRoot,
        env: {
          ...process.env,
          // Parent environments sometimes set this; it makes Electron run as Node and breaks app.
          ELECTRON_RUN_AS_NODE: '',
          FTH_SMOKE_RESULT_PATH: resultPath,
          ELECTRON_RENDERER_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });

    if (!existsSync(resultPath)) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error(
        `Smoke process exited ${exitCode} without writing results.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }

    const raw = readFileSync(resultPath, 'utf8');
    rmSync(dir, { recursive: true, force: true });
    const result = JSON.parse(raw) as {
      ok: boolean;
      details: { reason: string; snapshot?: { hasApi: boolean; rootText: string } };
      pageErrors: string[];
    };

    expect(result.pageErrors.join('\n')).not.toMatch(/Unable to load preload script/i);
    expect(result.pageErrors.join('\n')).not.toMatch(/module not found: zod/i);
    expect(result.pageErrors.join('\n')).not.toMatch(/can't detect preamble/i);
    expect(result.ok).toBe(true);
    expect(exitCode).toBe(0);
    expect(result.details.snapshot?.hasApi).toBe(true);
    expect(result.details.snapshot?.rootText.length).toBeGreaterThan(0);
    expect(result.details.snapshot?.rootText).toMatch(
      /Freshdesk Ticket Helper|First-run|Settings|Secure ticket/i,
    );
  }, 90_000);
});
