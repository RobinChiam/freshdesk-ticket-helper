/**
 * BrowserWindow factory with hardened Electron security defaults.
 * createAndLoadMainWindow is shared by startup and macOS activate so load logic stays single.
 */
import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

import { ALLOWED_EXTERNAL_HTTPS_HOST_SUFFIXES } from './security.js';

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Freshdesk Ticket Helper',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  window.on('ready-to-show', () => {
    window.show();
  });

  // Disable unexpected external navigation; allow only documented HTTPS destinations.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void maybeOpenExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const isDevRenderer =
      process.env['ELECTRON_RENDERER_URL'] != null &&
      url.startsWith(process.env['ELECTRON_RENDERER_URL']);
    const isFile = url.startsWith('file:');
    if (!isDevRenderer && !isFile) {
      event.preventDefault();
      void maybeOpenExternal(url);
    }
  });

  return window;
}

/** Create the main window and load either the Vite dev URL or packaged renderer HTML. */
export async function createAndLoadMainWindow(): Promise<BrowserWindow> {
  const window = createMainWindow();
  if (process.env['ELECTRON_RENDERER_URL']) {
    await window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}

async function maybeOpenExternal(url: string): Promise<void> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return;
    }
    const allowed = ALLOWED_EXTERNAL_HTTPS_HOST_SUFFIXES.some(
      (suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`),
    );
    if (allowed) {
      await shell.openExternal(url);
    }
  } catch {
    // Ignore malformed URLs rather than navigating.
  }
}
