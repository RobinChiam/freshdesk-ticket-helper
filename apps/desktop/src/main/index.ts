/**
 * Electron main process entry.
 * Owns Freshdesk HTTPS, WSS, SQLite, and the secret vault — never exposed to the renderer.
 *
 * SecretVault (tracked TypeScript in main/secrets/) encrypts runtime values into
 * userData/secrets.vault (untracked). Only the runtime vault file is sensitive.
 */
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

import { openAppDatabase } from '../database/index.js';
import { AiBrokerClient } from '../websocket/client.js';
import {
  broadcastChatEvent,
  broadcastConnectionStatus,
  registerIpcHandlers,
} from './ipc/handlers.js';
import { applyContentSecurityPolicy, hardenSessionPermissions } from './security.js';
import { SecretVault } from './secrets/vault.js';
import { loadSettings } from './settings/store.js';
import { createAndLoadMainWindow } from './window.js';

// Prevent multiple instances from sharing/corrupting local state.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let db: ReturnType<typeof openAppDatabase> | null = null;
let vault: SecretVault | null = null;
let broker: AiBrokerClient | null = null;

app.whenReady().then(async () => {
  applyContentSecurityPolicy();
  hardenSessionPermissions();

  const userData = app.getPath('userData');
  db = openAppDatabase(join(userData, 'app-state.sqlite'));
  // Runtime encrypted blob — never commit this file; path is outside the repo under userData.
  vault = new SecretVault(join(userData, 'secrets.vault'));

  const settings = loadSettings(db);
  broker = new AiBrokerClient({
    url: settings.wssUrl,
    deviceToken: vault.getWssDeviceToken() ?? '',
    clientVersion: app.getVersion(),
    useMockBroker: settings.useMockBroker,
    allowInsecureWs: !app.isPackaged,
    onStatus: (status) => broadcastConnectionStatus(() => mainWindow, status),
    onChatEvent: (event) => broadcastChatEvent(() => mainWindow, event),
  });

  registerIpcHandlers({
    db,
    vault,
    broker,
    getMainWindow: () => mainWindow,
  });

  mainWindow = await createAndLoadMainWindow();

  // Auto-connect mock broker so the chat panel is usable on first run.
  if (settings.useMockBroker) {
    await broker.connect();
  }

  // Optional Electron-native smoke path used by tests/electron-smoke.test.ts.
  if (process.env['FTH_SMOKE_RESULT_PATH']) {
    const { runStartupSmokeAndExit } = await import('./smokeProbe.js');
    await runStartupSmokeAndExit(mainWindow, process.env['FTH_SMOKE_RESULT_PATH']);
    return;
  }

  app.on('activate', () => {
    void (async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = await createAndLoadMainWindow();
      }
    })();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  broker?.disconnect();
  db?.close();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});
