/**
 * Startup smoke probe embedded in the real main process.
 * Verifies preload, desktopApi, and visible React mount without Playwright flags.
 */
import { writeFileSync } from 'node:fs';
import { app, type BrowserWindow } from 'electron';

export async function runStartupSmokeAndExit(
  window: BrowserWindow,
  resultPath: string,
): Promise<void> {
  const pageErrors: string[] = [];

  window.webContents.on('console-message', (_event, _level, message) => {
    pageErrors.push(String(message));
  });
  window.webContents.on('preload-error', (_event, _preloadPath, error) => {
    pageErrors.push(`preload-error: ${error instanceof Error ? error.message : String(error)}`);
  });

  await new Promise((resolve) => setTimeout(resolve, 2500));

  let payload: {
    ok: boolean;
    details: Record<string, unknown>;
    pageErrors: string[];
  };

  try {
    const snapshot = (await window.webContents.executeJavaScript(`({
      hasApi: typeof window.desktopApi !== 'undefined',
      rootText: (document.querySelector('#root')?.textContent || '').trim(),
    })`)) as { hasApi: boolean; rootText: string };

    const joined = pageErrors.join('\n');
    if (/Unable to load preload script/i.test(joined) || /module not found: zod/i.test(joined)) {
      payload = { ok: false, details: { reason: 'preload_failed', snapshot }, pageErrors };
    } else if (/can't detect preamble/i.test(joined)) {
      payload = { ok: false, details: { reason: 'csp_preamble', snapshot }, pageErrors };
    } else if (!snapshot.hasApi) {
      payload = { ok: false, details: { reason: 'desktopApi_missing', snapshot }, pageErrors };
    } else if (!snapshot.rootText) {
      payload = { ok: false, details: { reason: 'empty_root', snapshot }, pageErrors };
    } else {
      payload = { ok: true, details: { reason: 'ok', snapshot }, pageErrors };
    }
  } catch (error) {
    payload = {
      ok: false,
      details: { reason: 'execute_failed', error: String(error) },
      pageErrors,
    };
  }

  writeFileSync(resultPath, JSON.stringify(payload, null, 2));
  console.info('[smoke]', JSON.stringify(payload));
  app.exit(payload.ok ? 0 : 1);
}
