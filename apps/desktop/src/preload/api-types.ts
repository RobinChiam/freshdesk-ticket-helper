/**
 * Shared DesktopApi type used by preload and the renderer TypeScript project.
 */
import type {
  AppInfo,
  ChatEvent,
  ChatSendInput,
  ConnectionStatus,
  NonSecretSettings,
  SanitizedContext,
  SecretsStatus,
  SettingsSaveInput,
  TicketDetail,
  TicketOpenResult,
  TicketParseResult,
  RecentTicket,
  TestConnectionResult,
} from '@fth/protocol';

export type DesktopApi = {
  getAppInfo: () => Promise<AppInfo>;
  getSecretsStatus: () => Promise<SecretsStatus>;
  getSettings: () => Promise<NonSecretSettings>;
  saveSettings: (
    input: SettingsSaveInput,
  ) => Promise<{ settings: NonSecretSettings; secrets: SecretsStatus }>;
  testFreshdesk: () => Promise<TestConnectionResult>;
  testWss: () => Promise<TestConnectionResult>;
  parseTicket: (input: string) => Promise<TicketParseResult>;
  openTicket: (input: string) => Promise<TicketOpenResult>;
  listRecentTickets: () => Promise<RecentTicket[]>;
  previewSanitizer: (args: {
    ticket: TicketDetail;
    includePrivateNotes: boolean;
  }) => Promise<SanitizedContext>;
  sendChat: (
    input: ChatSendInput,
  ) => Promise<{ ok: true; requestId: string } | { ok: false; error: string }>;
  cancelChat: (requestId: string) => Promise<{ ok: true }>;
  getConnectionStatus: () => Promise<ConnectionStatus>;
  onConnectionStatus: (handler: (status: ConnectionStatus) => void) => () => void;
  onChatEvent: (handler: (event: ChatEvent) => void) => () => void;
};
