/**
 * Schema-free IPC channel constants for sandboxed preload.
 * This module must never import zod or any other npm runtime dependency —
 * sandboxed preload cannot require() unresolved node_modules packages.
 */
export const IpcChannels = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  secretsStatus: 'secrets:status',
  freshdeskTest: 'freshdesk:test',
  wssTest: 'wss:test',
  ticketParse: 'ticket:parse',
  ticketOpen: 'ticket:open',
  ticketRecent: 'ticket:recent',
  sanitizerPreview: 'sanitizer:preview',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  connectionStatus: 'connection:status',
  connectionStatusChanged: 'connection:status-changed',
  chatEvent: 'chat:event',
  appInfo: 'app:info',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
