/**
 * Electron main process entry.
 * Owns Freshdesk HTTP, WSS, SQLite, and the secret vault — never exposed to the renderer.
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
import { createMainWindow } from './window.js';

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

  mainWindow = createMainWindow();

  if (process.env['ELECTRON_RENDERER_URL']) {
    await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Auto-connect mock broker so the chat panel is usable on first run.
  if (settings.useMockBroker) {
    await broker.connect();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
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
