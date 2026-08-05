/**
 * Shared DesktopApi type used by preload and the renderer TypeScript project.
 */
import type {
  AppInfo,
  ChatEvent,
  ChatHistoryMessage,
  ChatSendInput,
  CliCheckInput,
  CliCheckResult,
  CliLocateInput,
  CliLocateResult,
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
  testAi: () => Promise<TestConnectionResult>;
  checkCli: (input: CliCheckInput) => Promise<CliCheckResult>;
  locateCli: (input: CliLocateInput) => Promise<CliLocateResult>;
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
  listChatHistory: (ticketKey: string) => Promise<ChatHistoryMessage[]>;
  clearChatHistory: (ticketKey: string) => Promise<{ ok: true; deleted: number }>;
  onChatEvent: (handler: (event: ChatEvent) => void) => () => void;
};
