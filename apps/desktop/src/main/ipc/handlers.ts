/**
 * IPC handler registration — every channel is schema-validated and sender-checked.
 * Handlers never return raw secrets to the renderer.
 * CLI execution stays in main; preload never receives spawn/exec or raw process output.
 */
import { dialog, ipcMain, app, type BrowserWindow } from 'electron';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  IpcChannels,
  chatCancelInputSchema,
  chatHistoryInputSchema,
  chatSendInputSchema,
  cliCheckInputSchema,
  cliLocateInputSchema,
  logicalProviderForAdapter,
  nonSecretSettingsSchema,
  sanitizerPreviewInputSchema,
  settingsSaveInputSchema,
  ticketParseInputSchema,
  type NonSecretSettings,
  type TicketDetail,
} from '@fth/protocol';

import type { AppDatabase } from '../../database/index.js';
import type { AiProviderService } from '../../ai/providerService.js';
import { sanitizeProviderError, type ProviderConfig } from '../../ai/providerRuntime.js';
import { checkCliInstallation } from '../../ai/cli/preflight.js';
import { createNodeProcessRunner } from '../../ai/cli/processRunner.js';
import { validateExecutableOverride } from '../../ai/cli/locator.js';
import { getAdapterDefinition } from '../../ai/cli/registry.js';
import { CliAdapterError } from '../../ai/cli/types.js';
import {
  FreshdeskApiError,
  FreshdeskClient,
  sanitizeFreshdeskError,
} from '../../freshdesk/client.js';
import { extractFreshdeskHostname, parseTicketInput } from '../../freshdesk/ticketUrl.js';
import { sanitizeUserMessage } from '../../sanitizer/index.js';
import type { SecretVault } from '../secrets/vault.js';
import { loadSettings, saveSettings } from '../settings/store.js';
import { TrustedTicketState } from '../trustedTicketState.js';
import { withTrustedSender } from './senderGuard.js';

export type AppContext = {
  db: AppDatabase;
  vault: SecretVault;
  ai: AiProviderService;
  getMainWindow: () => BrowserWindow | null;
};

const cliRunner = createNodeProcessRunner();

/** Register all typed IPC handlers once during app startup. */
export function registerIpcHandlers(ctx: AppContext): void {
  const trustedTicketState = new TrustedTicketState();
  const guard = <Args extends unknown[], Result>(
    handler: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
  ) => withTrustedSender(ctx.getMainWindow, handler);

  ipcMain.handle(
    IpcChannels.appInfo,
    guard(async () => ({
      name: 'Freshdesk Ticket Helper',
      version: app.getVersion(),
      isPackaged: app.isPackaged,
    })),
  );

  ipcMain.handle(
    IpcChannels.secretsStatus,
    guard(async () => ctx.vault.getStatus()),
  );

  ipcMain.handle(
    IpcChannels.settingsGet,
    guard(async () => loadSettings(ctx.db)),
  );

  ipcMain.handle(
    IpcChannels.settingsSave,
    guard(async (_event, raw: unknown) => {
      const previousSettings = loadSettings(ctx.db);
      const input = settingsSaveInputSchema.parse(raw);
      const { freshdeskApiKey, aiApiKey, clearFreshdeskApiKey, clearAiApiKey, ...nonSecret } =
        input;

      const settings = nonSecretSettingsSchema.parse(nonSecret);

      // Secrets are vault-only; empty strings mean "leave unchanged".
      if (clearFreshdeskApiKey) {
        ctx.vault.clearFreshdeskApiKey();
      } else if (freshdeskApiKey && freshdeskApiKey.trim()) {
        ctx.vault.setFreshdeskApiKey(freshdeskApiKey.trim());
      }

      // CLI mode never requires or saves an API key; ignore aiApiKey for subscription-cli.
      if (settings.aiConnection.kind === 'api-key') {
        if (clearAiApiKey) {
          ctx.vault.clearAiApiKey(settings.aiConnection.provider);
        } else if (aiApiKey && aiApiKey.trim()) {
          ctx.vault.setAiApiKey(settings.aiConnection.provider, aiApiKey.trim());
        }
      }

      // Re-validate any executable override in main before persisting.
      if (
        settings.aiConnection.kind === 'subscription-cli' &&
        settings.aiConnection.executablePath.trim()
      ) {
        try {
          settings.aiConnection.executablePath = validateExecutableOverride(
            settings.aiConnection.adapter,
            settings.aiConnection.executablePath.trim(),
          );
        } catch (error) {
          throw new Error(
            error instanceof CliAdapterError
              ? error.message
              : 'The selected CLI executable is not allowed.',
          );
        }
      }

      saveSettings(ctx.db, settings);
      if (settings.freshdeskUrl !== previousSettings.freshdeskUrl) {
        trustedTicketState.clear();
      } else if (settings.includePrivateNotesInAi !== previousSettings.includePrivateNotesInAi) {
        trustedTicketState.clearContexts();
      }
      return {
        settings,
        secrets: ctx.vault.getStatus(),
      };
    }),
  );

  ipcMain.handle(
    IpcChannels.freshdeskTest,
    guard(async () => {
      const settings = loadSettings(ctx.db);
      const apiKey = ctx.vault.getFreshdeskApiKey();
      if (!settings.freshdeskUrl || !apiKey) {
        return {
          ok: false as const,
          error: 'Configure Freshdesk URL and API key before testing.',
        };
      }
      try {
        const client = new FreshdeskClient({
          accountUrl: settings.freshdeskUrl,
          apiKey,
        });
        return client.testConnection();
      } catch (error) {
        return { ok: false as const, error: sanitizeFreshdeskError(error) };
      }
    }),
  );

  ipcMain.handle(
    IpcChannels.aiTest,
    guard(async () => {
      const settings = loadSettings(ctx.db);
      const configured = getProviderConfig(settings, ctx.vault);
      if (!configured.ok) return configured;
      try {
        await ctx.ai.test(configured.config);
        return {
          ok: true as const,
          message:
            configured.config.kind === 'subscription-cli'
              ? 'CLI subscription connection test succeeded.'
              : 'AI provider authentication and model request succeeded.',
        };
      } catch (error) {
        return { ok: false as const, error: sanitizeProviderError(error).error };
      }
    }),
  );

  ipcMain.handle(
    IpcChannels.cliCheck,
    guard(async (_event, raw: unknown) => {
      const input = cliCheckInputSchema.parse(raw);
      return checkCliInstallation(input.adapter, input.executablePath, { runner: cliRunner });
    }),
  );

  ipcMain.handle(
    IpcChannels.cliLocate,
    guard(async (_event, raw: unknown) => {
      const input = cliLocateInputSchema.parse(raw);
      const def = getAdapterDefinition(input.adapter);
      const win = ctx.getMainWindow();
      const options = {
        title: `Locate ${def.displayName}`,
        properties: ['openFile' as const],
        defaultPath: homedir(),
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false as const, cancelled: true, error: 'No executable selected.' };
      }
      try {
        const executablePath = validateExecutableOverride(input.adapter, result.filePaths[0]);
        return { ok: true as const, adapter: input.adapter, executablePath };
      } catch (error) {
        return {
          ok: false as const,
          error:
            error instanceof CliAdapterError
              ? error.message
              : 'The selected file is not an allowed CLI executable.',
        };
      }
    }),
  );

  ipcMain.handle(
    IpcChannels.ticketParse,
    guard(async (_event, raw: unknown) => {
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
    }),
  );

  ipcMain.handle(
    IpcChannels.ticketOpen,
    guard(async (_event, raw: unknown) => {
      const { input } = ticketParseInputSchema.parse(raw);
      const settings = loadSettings(ctx.db);

      // Offline demo ticket so the UI can be exercised without real Freshdesk credentials.
      if (input.trim().toLowerCase() === 'demo') {
        const ticket = buildDemoTicket();
        trustedTicketState.rememberTicket(ticket);
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
        trustedTicketState.rememberTicket(ticket);
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
    }),
  );

  ipcMain.handle(
    IpcChannels.ticketRecent,
    guard(async () => ctx.db.listRecentTickets(25)),
  );

  ipcMain.handle(
    IpcChannels.sanitizerPreview,
    guard(async (_event, raw: unknown) => {
      const input = sanitizerPreviewInputSchema.parse(raw);
      const settings = loadSettings(ctx.db);
      if (!trustedTicketState.hasTicket(input.ticket.ticketKey)) {
        throw new Error('Reopen the ticket before preparing AI context.');
      }
      const revision = ctx.db.bumpContextRevision(input.ticket.ticketKey);
      const context = trustedTicketState.buildContext(
        input.ticket.ticketKey,
        settings.includePrivateNotesInAi,
        revision,
      );
      if (!context) throw new Error('Reopen the ticket before preparing AI context.');
      return context;
    }),
  );

  ipcMain.handle(
    IpcChannels.chatSend,
    guard(async (_event, raw: unknown) => {
      // Schema enforces ticketKey/contextRevision identity with sanitizedContext.
      const input = chatSendInputSchema.parse(raw);
      const settings = loadSettings(ctx.db);
      const trustedContext = trustedTicketState.getContext(input.ticketKey, input.contextRevision);
      if (!trustedContext) {
        return {
          ok: false as const,
          error: 'The ticket context is stale. Reopen the ticket before chatting.',
        };
      }

      // Defense in depth: never send private notes when the toggle is off.
      // Private notes are only present when Freshdesk returned them for this API key.
      if (!settings.includePrivateNotesInAi && trustedContext.includePrivateNotes) {
        return {
          ok: false as const,
          error: 'Private notes are disabled in settings but present in the sanitized context.',
        };
      }

      const configured = getProviderConfig(settings, ctx.vault);
      if (!configured.ok) return configured;
      const sanitizedQuestion = sanitizeUserMessage(input.userMessage);
      if (!sanitizedQuestion)
        return { ok: false as const, error: 'Enter a message with visible text.' };
      try {
        // Replace renderer-supplied context with the main-process copy before any network request.
        const trustedInput = { ...input, sanitizedContext: trustedContext };
        return {
          ok: true as const,
          ...ctx.ai.start(trustedInput, configured.config, sanitizedQuestion),
        };
      } catch {
        return { ok: false as const, error: 'This chat request could not be started.' };
      }
    }),
  );

  ipcMain.handle(
    IpcChannels.chatCancel,
    guard(async (_event, raw: unknown) => {
      const input = chatCancelInputSchema.parse(raw);
      ctx.ai.cancel(input.requestId);
      return { ok: true as const };
    }),
  );

  ipcMain.handle(
    IpcChannels.chatHistoryList,
    guard(async (_event, raw: unknown) => {
      const { ticketKey } = chatHistoryInputSchema.parse(raw);
      return ctx.db.listChatMessages(ticketKey, 200);
    }),
  );

  ipcMain.handle(
    IpcChannels.chatHistoryClear,
    guard(async (_event, raw: unknown) => {
      const { ticketKey } = chatHistoryInputSchema.parse(raw);
      return { ok: true as const, deleted: ctx.db.clearChatMessages(ticketKey) };
    }),
  );
}

export function broadcastChatEvent(
  getMainWindow: () => BrowserWindow | null,
  event: unknown,
): void {
  const win = getMainWindow();
  win?.webContents.send(IpcChannels.chatEvent, event);
}

export function getProviderConfig(
  settings: NonSecretSettings,
  vault: SecretVault,
): { ok: true; config: ProviderConfig } | { ok: false; error: string } {
  const connection = settings.aiConnection;
  if (connection.kind === 'subscription-cli') {
    return {
      ok: true,
      config: {
        kind: 'subscription-cli',
        adapter: connection.adapter,
        logicalProviderId: logicalProviderForAdapter(connection.adapter),
        modelId: connection.modelId.trim(),
        executablePath: connection.executablePath.trim(),
      },
    };
  }

  const modelId = connection.modelId.trim();
  if (!modelId) return { ok: false, error: 'Configure an AI model ID first.' };
  const apiKey = vault.getAiApiKey(connection.provider);
  if (!apiKey) return { ok: false, error: 'Store an API key for the selected AI provider first.' };
  if (connection.provider === 'openai-compatible' && !connection.customBaseUrl) {
    return { ok: false, error: 'Configure an HTTPS base URL for the custom provider.' };
  }
  return {
    ok: true,
    config: {
      kind: 'api-key',
      providerId: connection.provider,
      modelId,
      customBaseUrl: connection.customBaseUrl,
      apiKey,
    },
  };
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
        bodyText:
          'Please check the reset link. Card ending 4111 1111 1111 1111 was charged by mistake.',
        createdAt: now,
        private: false,
        incoming: true,
        role: 'requester',
        fromEmail: 'customer.demo@example.com',
        supportEmail: null,
      },
      {
        id: 2,
        bodyText:
          'INTERNAL: User may be on plan Pro. Bearer DEMO_TOKEN_VALUE_1234567890 observed in logs — do not share.',
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
