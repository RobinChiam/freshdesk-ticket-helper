/**
 * Preload bridge: exposes a narrow, typed API via contextBridge.
 * No generic filesystem, shell, or HTTP access is provided to the renderer.
 *
 * Runtime imports must stay sandbox-safe: only Electron plus inlined channel
 * constants (relative source import — never require() a workspace package).
 * Schema types are import type-only and erased at compile.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// Relative source import so electron-vite inlines constants into the preload CJS bundle.
import { IpcChannels } from '../../../../packages/protocol/src/channels';
import type { ChatEvent } from '@fth/protocol';

import type { DesktopApi } from './api-types';

const api: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.appInfo),
  getSecretsStatus: () => ipcRenderer.invoke(IpcChannels.secretsStatus),
  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet),
  saveSettings: (input) => ipcRenderer.invoke(IpcChannels.settingsSave, input),
  testFreshdesk: () => ipcRenderer.invoke(IpcChannels.freshdeskTest),
  testAi: () => ipcRenderer.invoke(IpcChannels.aiTest),
  checkCli: (input) => ipcRenderer.invoke(IpcChannels.cliCheck, input),
  locateCli: (input) => ipcRenderer.invoke(IpcChannels.cliLocate, input),
  parseTicket: (input) => ipcRenderer.invoke(IpcChannels.ticketParse, { input }),
  openTicket: (input) => ipcRenderer.invoke(IpcChannels.ticketOpen, { input }),
  listRecentTickets: () => ipcRenderer.invoke(IpcChannels.ticketRecent),
  previewSanitizer: (args) => ipcRenderer.invoke(IpcChannels.sanitizerPreview, args),
  sendChat: (input) => ipcRenderer.invoke(IpcChannels.chatSend, input),
  cancelChat: (requestId) => ipcRenderer.invoke(IpcChannels.chatCancel, { requestId }),
  listChatHistory: (ticketKey) => ipcRenderer.invoke(IpcChannels.chatHistoryList, { ticketKey }),
  clearChatHistory: (ticketKey) => ipcRenderer.invoke(IpcChannels.chatHistoryClear, { ticketKey }),
  onChatEvent: (handler) => {
    const listener = (_event: IpcRendererEvent, chatEvent: ChatEvent) => handler(chatEvent);
    ipcRenderer.on(IpcChannels.chatEvent, listener);
    return () => ipcRenderer.removeListener(IpcChannels.chatEvent, listener);
  },
};

contextBridge.exposeInMainWorld('desktopApi', api);
