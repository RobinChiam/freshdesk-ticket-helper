/** Typed, schema-validated IPC contracts shared by Electron main and preload. */
import { z } from 'zod';

import { IpcChannels, type IpcChannel } from './channels.js';
import { ticketKeySchema } from './common.js';

export { IpcChannels, type IpcChannel };

export const freshdeskAccountUrlSchema = z.union([
  z.literal(''),
  z
    .string()
    .url()
    .refine((value) => value.startsWith('https://'), {
      message: 'Freshdesk account URL must use https://',
    }),
]);

/** Logical model-provider identity (not a CLI executable name). */
export const aiProviderIdSchema = z.enum(['google', 'openai', 'anthropic', 'openai-compatible']);
export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

/**
 * Subscription-CLI adapters only. Cursor is intentionally absent and must not be added.
 * Logical mapping: antigravity→google, codex→openai, claude-code→anthropic.
 */
export const cliAdapterIdSchema = z.enum(['antigravity', 'codex', 'claude-code']);
export type CliAdapterId = z.infer<typeof cliAdapterIdSchema>;

export const aiConnectionKindSchema = z.enum(['api-key', 'subscription-cli']);
export type AiConnectionKind = z.infer<typeof aiConnectionKindSchema>;

export const customBaseUrlSchema = z.union([
  z.literal(''),
  z
    .string()
    .url()
    .superRefine((value, ctx) => {
      const url = new URL(value);
      if (url.protocol !== 'https:') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Custom provider URL must use https://',
        });
      }
      if (url.username || url.password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Custom provider URL cannot contain credentials',
        });
      }
    }),
]);

/** Absolute path stored only after main-process validation; never a free-form command. */
export const cliExecutablePathSchema = z
  .string()
  .max(4_096)
  .refine((value) => value.length === 0 || value.includes('/') || value.includes('\\'), {
    message: 'CLI executable override must be an absolute path',
  });

const apiKeyConnectionSchema = z.object({
  kind: z.literal('api-key'),
  provider: aiProviderIdSchema,
  modelId: z.string().max(256),
  customBaseUrl: customBaseUrlSchema,
});

const subscriptionCliConnectionSchema = z.object({
  kind: z.literal('subscription-cli'),
  adapter: cliAdapterIdSchema,
  /** Optional model override only where the installed CLI documents model selection. */
  modelId: z.string().max(256).default(''),
  /**
   * Non-secret validated absolute path from “Locate CLI”. Empty means auto-discovery.
   * Renderer cannot supply arbitrary commands — main re-validates before spawn.
   */
  executablePath: z.string().max(4_096).default(''),
});

export const aiConnectionSchema = z.discriminatedUnion('kind', [
  apiKeyConnectionSchema,
  subscriptionCliConnectionSchema,
]);
export type AiConnection = z.infer<typeof aiConnectionSchema>;

export const nonSecretSettingsSchema = z.object({
  freshdeskUrl: freshdeskAccountUrlSchema,
  freshdeskUiHosts: z.array(z.string().min(1)).default([]),
  includePrivateNotesInAi: z.boolean().default(false),
  onboardingComplete: z.boolean().default(false),
  aiConnection: aiConnectionSchema.default({
    kind: 'api-key',
    provider: 'google',
    modelId: '',
    customBaseUrl: '',
  }),
});
export type NonSecretSettings = z.infer<typeof nonSecretSettingsSchema>;

export const settingsSaveInputSchema = nonSecretSettingsSchema.extend({
  freshdeskApiKey: z.string().max(4_096).optional(),
  /** API-key mode only; ignored for subscription-cli. */
  aiApiKey: z.string().max(4_096).optional(),
  clearFreshdeskApiKey: z.boolean().optional(),
  clearAiApiKey: z.boolean().optional(),
});
export type SettingsSaveInput = z.infer<typeof settingsSaveInputSchema>;

const providerPresenceSchema = z.object({
  google: z.boolean(),
  openai: z.boolean(),
  anthropic: z.boolean(),
  'openai-compatible': z.boolean(),
});

export const secretsStatusSchema = z.object({
  encryptionAvailable: z.boolean(),
  storageBackend: z.string(),
  freshdeskApiKeyPresent: z.boolean(),
  aiProviderKeyPresent: providerPresenceSchema,
  limitation: z.string().nullable(),
});
export type SecretsStatus = z.infer<typeof secretsStatusSchema>;

export const cliInstallStatusSchema = z.enum([
  'not_checked',
  'installed',
  'installed_auth_unverified',
  'ready',
  'missing',
  'login_required',
  'unsupported_version',
  'secure_automation_unsupported',
  'test_timed_out',
  'quota_rate_limited',
  'error',
]);
export type CliInstallStatus = z.infer<typeof cliInstallStatusSchema>;

export const cliCheckInputSchema = z.object({
  adapter: cliAdapterIdSchema,
  executablePath: z.string().max(4_096).optional(),
});
export type CliCheckInput = z.infer<typeof cliCheckInputSchema>;

export const cliCheckResultSchema = z.object({
  adapter: cliAdapterIdSchema,
  status: cliInstallStatusSchema,
  executablePath: z.string().nullable(),
  version: z.string().nullable(),
  message: z.string(),
});
export type CliCheckResult = z.infer<typeof cliCheckResultSchema>;

export const cliLocateInputSchema = z.object({
  adapter: cliAdapterIdSchema,
});
export type CliLocateInput = z.infer<typeof cliLocateInputSchema>;

export const cliLocateResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    adapter: cliAdapterIdSchema,
    executablePath: z.string().min(1),
  }),
  z.object({
    ok: z.literal(false),
    cancelled: z.boolean().optional(),
    error: z.string(),
  }),
]);
export type CliLocateResult = z.infer<typeof cliLocateResultSchema>;

export const ticketParseInputSchema = z.object({ input: z.string().min(1).max(2048) });
export const ticketParseResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    ticketId: z.number().int().positive(),
    source: z.enum(['id', 'url']),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type TicketParseResult = z.infer<typeof ticketParseResultSchema>;

export const conversationRoleSchema = z.enum(['requester', 'agent', 'system', 'unknown']);
export const conversationMessageSchema = z.object({
  id: z.number().int(),
  bodyText: z.string(),
  createdAt: z.string(),
  private: z.boolean(),
  incoming: z.boolean(),
  role: conversationRoleSchema,
  fromEmail: z.string().nullable(),
  supportEmail: z.string().nullable(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const ticketDetailSchema = z.object({
  ticketKey: ticketKeySchema,
  id: z.number().int().positive(),
  subject: z.string(),
  descriptionText: z.string(),
  status: z.union([z.number(), z.string()]),
  priority: z.union([z.number(), z.string()]),
  requesterId: z.number().nullable(),
  responderId: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  conversations: z.array(conversationMessageSchema),
  fetchedAt: z.string(),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const ticketOpenResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), ticket: ticketDetailSchema }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      'parse_error',
      'not_configured',
      'permission_denied',
      'not_found',
      'network_error',
      'unknown',
    ]),
    error: z.string(),
  }),
]);
export type TicketOpenResult = z.infer<typeof ticketOpenResultSchema>;

export const recentTicketSchema = z.object({
  ticketKey: ticketKeySchema,
  ticketId: z.number().int().positive(),
  subject: z.string(),
  openedAt: z.string(),
});
export type RecentTicket = z.infer<typeof recentTicketSchema>;

export const sanitizedMessageSchema = z.object({
  id: z.number().int(),
  role: conversationRoleSchema,
  visibility: z.enum(['PUBLIC', 'INTERNAL_NOTE', 'EXCLUDED_INTERNAL_NOTE']),
  text: z.string(),
  createdAt: z.string(),
});
export const sanitizedContextSchema = z.object({
  ticketKey: ticketKeySchema,
  contextRevision: z.number().int().positive(),
  subject: z.string(),
  includePrivateNotes: z.boolean(),
  redactionMap: z.record(z.string(), z.string()),
  messages: z.array(sanitizedMessageSchema),
  warnings: z.array(z.string()),
  previewText: z.string(),
});
export type SanitizedContext = z.infer<typeof sanitizedContextSchema>;
export const sanitizerPreviewInputSchema = z.object({
  ticket: ticketDetailSchema,
  includePrivateNotes: z.boolean(),
});

export const chatSendInputSchema = z
  .object({
    ticketKey: ticketKeySchema,
    contextRevision: z.number().int().positive(),
    sanitizedContext: sanitizedContextSchema,
    userMessage: z.string().min(1).max(16_000),
    clientRequestKey: z.string().uuid(),
  })
  .superRefine((value, ctx) => {
    if (value.ticketKey !== value.sanitizedContext.ticketKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ticketKey must match sanitizedContext.ticketKey',
        path: ['ticketKey'],
      });
    }
    if (value.contextRevision !== value.sanitizedContext.contextRevision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'contextRevision must match sanitizedContext.contextRevision',
        path: ['contextRevision'],
      });
    }
  });
export type ChatSendInput = z.infer<typeof chatSendInputSchema>;

export const chatCancelInputSchema = z.object({ requestId: z.string().uuid() });
export const chatHistoryInputSchema = z.object({ ticketKey: ticketKeySchema });
export const chatHistoryMessageSchema = z.object({
  id: z.string().uuid(),
  ticketKey: ticketKeySchema,
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  providerId: aiProviderIdSchema,
  modelId: z.string(),
  connectionKind: aiConnectionKindSchema.default('api-key'),
  cliAdapterId: cliAdapterIdSchema.optional(),
  contextRevision: z.number().int().positive(),
  createdAt: z.string(),
});
export type ChatHistoryMessage = z.infer<typeof chatHistoryMessageSchema>;

const chatEventBase = {
  requestId: z.string().uuid(),
  ticketKey: ticketKeySchema,
};
export const chatEventSchema = z.discriminatedUnion('type', [
  z.object({ ...chatEventBase, type: z.literal('started') }),
  z.object({
    ...chatEventBase,
    type: z.literal('delta'),
    sequence: z.number().int().nonnegative(),
    text: z.string(),
  }),
  z.object({ ...chatEventBase, type: z.literal('completed'), text: z.string() }),
  z.object({ ...chatEventBase, type: z.literal('failed'), error: z.string(), code: z.string() }),
  z.object({ ...chatEventBase, type: z.literal('cancelled') }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;

export const testConnectionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), message: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type TestConnectionResult = z.infer<typeof testConnectionResultSchema>;

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  isPackaged: z.boolean(),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

/** Map subscription adapters to their logical API-key provider identities. */
export function logicalProviderForAdapter(
  adapter: CliAdapterId,
): Exclude<AiProviderId, 'openai-compatible'> {
  switch (adapter) {
    case 'antigravity':
      return 'google';
    case 'codex':
      return 'openai';
    case 'claude-code':
      return 'anthropic';
  }
}
