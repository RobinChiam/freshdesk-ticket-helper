/**
 * IPC handler registration — every channel is schema-validated.
 * Handlers never return raw secrets to the renderer.
 */
import { ipcMain, app, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';

import {
  IpcChannels,
  chatCancelInputSchema,
  chatSendInputSchema,
  nonSecretSettingsSchema,
  sanitizerPreviewInputSchema,
  settingsSaveInputSchema,
  ticketParseInputSchema,
  type ConnectionStatus,
  type NonSecretSettings,
  type TicketDetail,
} from '@fth/protocol';

import type { AppDatabase } from '../../database/index.js';
import { FreshdeskApiError, FreshdeskClient, sanitizeFreshdeskError } from '../../freshdesk/client.js';
import {
  extractFreshdeskHostname,
  parseTicketInput,
} from '../../freshdesk/ticketUrl.js';
import { buildSanitizedContext } from '../../sanitizer/index.js';
import type { AiBrokerClient } from '../../websocket/client.js';
import type { SecretVault } from '../secrets/vault.js';
import { loadSettings, saveSettings } from '../settings/store.js';

export type AppContext = {
  db: AppDatabase;
  vault: SecretVault;
  broker: AiBrokerClient;
  getMainWindow: () => BrowserWindow | null;
};

/** Register all typed IPC handlers once during app startup. */
export function registerIpcHandlers(ctx: AppContext): void {
  ipcMain.handle(IpcChannels.appInfo, async () => ({
    name: 'Freshdesk Ticket Helper',
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    mockBrokerDefault: true,
  }));

  ipcMain.handle(IpcChannels.secretsStatus, async () => ctx.vault.getStatus());

  ipcMain.handle(IpcChannels.settingsGet, async () => loadSettings(ctx.db));

  ipcMain.handle(IpcChannels.settingsSave, async (_event, raw: unknown) => {
    const input = settingsSaveInputSchema.parse(raw);
    const {
      freshdeskApiKey,
      wssDeviceToken,
      clearFreshdeskApiKey,
      clearWssDeviceToken,
      ...nonSecret
    } = input;

    const settings = saveSettings(ctx.db, nonSecretSettingsSchema.parse(nonSecret));

    // Secrets are vault-only; empty strings mean "leave unchanged".
    if (clearFreshdeskApiKey) {
      ctx.vault.clearFreshdeskApiKey();
    } else if (freshdeskApiKey && freshdeskApiKey.trim()) {
      ctx.vault.setFreshdeskApiKey(freshdeskApiKey.trim());
    }

    if (clearWssDeviceToken) {
      ctx.vault.clearWssDeviceToken();
    } else if (wssDeviceToken && wssDeviceToken.trim()) {
      ctx.vault.setWssDeviceToken(wssDeviceToken.trim());
    }

    reconfigureBroker(ctx, settings);
    return {
      settings,
      secrets: ctx.vault.getStatus(),
    };
  });

  ipcMain.handle(IpcChannels.freshdeskTest, async () => {
    const settings = loadSettings(ctx.db);
    const apiKey = ctx.vault.getFreshdeskApiKey();
    if (!settings.freshdeskUrl || !apiKey) {
      return {
        ok: false as const,
        error: 'Configure Freshdesk URL and API key before testing.',
      };
    }
    const client = new FreshdeskClient({
      accountUrl: settings.freshdeskUrl,
      apiKey,
    });
    return client.testConnection();
  });

  ipcMain.handle(IpcChannels.wssTest, async () => {
    const settings = loadSettings(ctx.db);
    reconfigureBroker(ctx, settings);
    return ctx.broker.testConnection();
  });

  ipcMain.handle(IpcChannels.ticketParse, async (_event, raw: unknown) => {
    const { input } = ticketParseInputSchema.parse(raw);
    const settings = loadSettings(ctx.db);
    const hostname = extractFreshdeskHostname(settings.freshdeskUrl);
    if (!hostname) {
      return { ok: false as const, error: 'Configure a valid Freshdesk account URL first.' };
    }
    return parseTicketInput(input, {
      apiHostname: hostname,
      allowedUiHosts: settings.freshdeskUiHosts,
    });
  });

  ipcMain.handle(IpcChannels.ticketOpen, async (_event, raw: unknown) => {
    const { input } = ticketParseInputSchema.parse(raw);
    const settings = loadSettings(ctx.db);

    // Offline demo ticket so the UI can be exercised without real Freshdesk credentials.
    if (input.trim().toLowerCase() === 'demo') {
      const ticket = buildDemoTicket();
      ctx.db.upsertRecentTicket({
        ticketKey: ticket.ticketKey,
        ticketId: ticket.id,
        subject: ticket.subject,
        openedAt: new Date().toISOString(),
      });
      return { ok: true as const, ticket };
    }

    const hostname = extractFreshdeskHostname(settings.freshdeskUrl);
    const apiKey = ctx.vault.getFreshdeskApiKey();

    if (!hostname || !settings.freshdeskUrl || !apiKey) {
      return {
        ok: false as const,
        code: 'not_configured' as const,
        error:
          'Freshdesk URL and API key are required to open a ticket. Enter "demo" to load a local sample ticket.',
      };
    }

    const parsed = parseTicketInput(input, {
      apiHostname: hostname,
      allowedUiHosts: settings.freshdeskUiHosts,
    });
    if (!parsed.ok) {
      return { ok: false as const, code: 'parse_error' as const, error: parsed.error };
    }

    try {
      const client = new FreshdeskClient({
        accountUrl: settings.freshdeskUrl,
        apiKey,
      });
      const ticket = await client.fetchTicket(parsed.ticketId);
      ctx.db.upsertRecentTicket({
        ticketKey: ticket.ticketKey,
        ticketId: ticket.id,
        subject: ticket.subject,
        openedAt: new Date().toISOString(),
      });
      return { ok: true as const, ticket };
    } catch (error) {
      return mapTicketOpenError(error);
    }
  });

  ipcMain.handle(IpcChannels.ticketRecent, async () => ctx.db.listRecentTickets(25));

  ipcMain.handle(IpcChannels.sanitizerPreview, async (_event, raw: unknown) => {
    const input = sanitizerPreviewInputSchema.parse(raw);
    const revision = ctx.db.bumpContextRevision(input.ticket.ticketKey);
    return buildSanitizedContext({
      ticket: input.ticket,
      includePrivateNotes: input.includePrivateNotes,
      contextRevision: revision,
    });
  });

  ipcMain.handle(IpcChannels.chatSend, async (_event, raw: unknown) => {
    const input = chatSendInputSchema.parse(raw);
    const settings = loadSettings(ctx.db);
    reconfigureBroker(ctx, settings);

    // Defense in depth: never send unsanitized private notes when the toggle is off.
    if (!settings.includePrivateNotesInAi && input.sanitizedContext.includePrivateNotes) {
      return {
        ok: false as const,
        error: 'Private notes are disabled in settings but present in the sanitized context.',
      };
    }

    return ctx.broker.sendChat({
      ticketKey: input.ticketKey,
      context: input.sanitizedContext,
      userMessage: input.userMessage,
      clientRequestKey: input.clientRequestKey,
    });
  });

  ipcMain.handle(IpcChannels.chatCancel, async (_event, raw: unknown) => {
    const input = chatCancelInputSchema.parse(raw);
    ctx.broker.cancel(input.requestId);
    return { ok: true as const };
  });

  ipcMain.handle(IpcChannels.connectionStatus, async () => ctx.broker.getStatus());
}

export function broadcastConnectionStatus(
  getMainWindow: () => BrowserWindow | null,
  status: ConnectionStatus,
): void {
  const win = getMainWindow();
  win?.webContents.send(IpcChannels.connectionStatusChanged, status);
}

export function broadcastChatEvent(
  getMainWindow: () => BrowserWindow | null,
  event: unknown,
): void {
  const win = getMainWindow();
  win?.webContents.send(IpcChannels.chatEvent, event);
}

function reconfigureBroker(ctx: AppContext, settings: NonSecretSettings): void {
  const token = ctx.vault.getWssDeviceToken() ?? '';
  ctx.broker.configure({
    url: settings.wssUrl,
    deviceToken: token,
    useMockBroker: settings.useMockBroker,
    allowInsecureWs: !app.isPackaged,
    clientVersion: app.getVersion(),
  });
}

function mapTicketOpenError(error: unknown): {
  ok: false;
  code: 'permission_denied' | 'not_found' | 'network_error' | 'unknown';
  error: string;
} {
  if (error instanceof FreshdeskApiError) {
    return {
      ok: false,
      code: error.code,
      error: sanitizeFreshdeskError(error),
    };
  }
  return {
    ok: false,
    code: 'unknown',
    error: sanitizeFreshdeskError(error),
  };
}

/** Demo ticket for offline UI exploration when Freshdesk is not configured. */
export function buildDemoTicket(hostname = 'demo.freshdesk.com'): TicketDetail {
  const now = new Date().toISOString();
  return {
    ticketKey: `${hostname}:8812`,
    id: 8812,
    subject: 'Cannot reset password for portal login',
    descriptionText:
      'Hi, I cannot reset my password. My email is customer.demo@example.com and phone is +1 555-010-9988.',
    status: 2,
    priority: 2,
    requesterId: 1,
    responderId: 2,
    createdAt: now,
    updatedAt: now,
    conversations: [
      {
        id: 1,
        bodyText: 'Please check the reset link. Card ending 4111 1111 1111 1111 was charged by mistake.',
        createdAt: now,
        private: false,
        incoming: true,
        role: 'requester',
        fromEmail: 'customer.demo@example.com',
        supportEmail: null,
      },
      {
        id: 2,
        bodyText: 'INTERNAL: User may be on plan Pro. Auth token sk-demo-aaaaaaaaaaaaaaaaaaaa observed in logs — do not share.',
        createdAt: now,
        private: true,
        incoming: false,
        role: 'agent',
        fromEmail: 'agent@example.com',
        supportEmail: 'support@example.com',
      },
      {
        id: 3,
        bodyText: 'Thanks, I clicked the link again.',
        createdAt: now,
        private: false,
        incoming: true,
        role: 'requester',
        fromEmail: 'customer.demo@example.com',
        supportEmail: null,
      },
    ],
    fetchedAt: now,
  };
}

export function newClientRequestKey(): string {
  return randomUUID();
}
