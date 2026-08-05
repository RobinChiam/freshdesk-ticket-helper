/** Channel constants safe to inline into the sandboxed preload bundle. */
export const IpcChannels = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  secretsStatus: 'secrets:status',
  freshdeskTest: 'freshdesk:test',
  aiTest: 'ai:test',
  /** Main-process CLI discovery/auth preflight — never exposes spawn or raw process output. */
  cliCheck: 'cli:check',
  /** Native file picker + path validation for optional CLI executable override. */
  cliLocate: 'cli:locate',
  ticketParse: 'ticket:parse',
  ticketOpen: 'ticket:open',
  ticketRecent: 'ticket:recent',
  sanitizerPreview: 'sanitizer:preview',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatHistoryList: 'chat:history:list',
  chatHistoryClear: 'chat:history:clear',
  chatEvent: 'chat:event',
  appInfo: 'app:info',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
