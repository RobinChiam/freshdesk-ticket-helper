/**
 * Preload bridge: exposes a narrow, typed API via contextBridge.
 * No generic filesystem, shell, or HTTP access is provided to the renderer.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  IpcChannels,
  type ChatEvent,
  type ConnectionStatus,
} from '@fth/protocol';

import type { DesktopApi } from './api-types';

const api: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.appInfo),
  getSecretsStatus: () => ipcRenderer.invoke(IpcChannels.secretsStatus),
  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet),
  saveSettings: (input) => ipcRenderer.invoke(IpcChannels.settingsSave, input),
  testFreshdesk: () => ipcRenderer.invoke(IpcChannels.freshdeskTest),
  testWss: () => ipcRenderer.invoke(IpcChannels.wssTest),
  parseTicket: (input) => ipcRenderer.invoke(IpcChannels.ticketParse, { input }),
  openTicket: (input) => ipcRenderer.invoke(IpcChannels.ticketOpen, { input }),
  listRecentTickets: () => ipcRenderer.invoke(IpcChannels.ticketRecent),
  previewSanitizer: (args) => ipcRenderer.invoke(IpcChannels.sanitizerPreview, args),
  sendChat: (input) => ipcRenderer.invoke(IpcChannels.chatSend, input),
  cancelChat: (requestId) => ipcRenderer.invoke(IpcChannels.chatCancel, { requestId }),
  getConnectionStatus: () => ipcRenderer.invoke(IpcChannels.connectionStatus),
  onConnectionStatus: (handler) => {
    const listener = (_event: IpcRendererEvent, status: ConnectionStatus) => handler(status);
    ipcRenderer.on(IpcChannels.connectionStatusChanged, listener);
    return () => ipcRenderer.removeListener(IpcChannels.connectionStatusChanged, listener);
  },
  onChatEvent: (handler) => {
    const listener = (_event: IpcRendererEvent, chatEvent: ChatEvent) => handler(chatEvent);
    ipcRenderer.on(IpcChannels.chatEvent, listener);
    return () => ipcRenderer.removeListener(IpcChannels.chatEvent, listener);
  },
};

contextBridge.exposeInMainWorld('desktopApi', api);
