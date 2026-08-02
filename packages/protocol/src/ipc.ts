/**
 * Typed IPC channel contracts between renderer (via preload) and Electron main.
 * Only these channels are exposed; no generic filesystem/shell/HTTP bridge.
 */
import { z } from 'zod';

import { IpcChannels, type IpcChannel } from './channels.js';
import { ticketKeySchema } from './common.js';

export { IpcChannels, type IpcChannel };

/** Freshdesk account URL: empty (unset) or https only — API keys travel via Basic auth. */
export const freshdeskAccountUrlSchema = z.union([
  z.literal(''),
  z
    .string()
    .url()
    .refine((value) => value.startsWith('https://'), {
      message: 'Freshdesk account URL must use https://',
    }),
]);

export const nonSecretSettingsSchema = z.object({
  freshdeskUrl: freshdeskAccountUrlSchema,
  /** Optional additional UI hostnames allowed when parsing ticket links. */
  freshdeskUiHosts: z.array(z.string().min(1)).default([]),
  wssUrl: z.string().url().or(z.literal('')).or(z.string().startsWith('wss://')),
  /** When true, desktop uses the in-process mock broker instead of real WSS. */
  useMockBroker: z.boolean().default(true),
  includePrivateNotesInAi: z.boolean().default(false),
  onboardingComplete: z.boolean().default(false),
});

export type NonSecretSettings = z.infer<typeof nonSecretSettingsSchema>;

export const settingsSaveInputSchema = nonSecretSettingsSchema.extend({
  /** Freshdesk API key — never persisted to SQLite; vault only. */
  freshdeskApiKey: z.string().optional(),
  /** WSS pairing/device token — vault only. */
  wssDeviceToken: z.string().optional(),
  /** Clear stored Freshdesk API key from the OS vault. */
  clearFreshdeskApiKey: z.boolean().optional(),
  /** Clear stored WSS device token from the OS vault. */
  clearWssDeviceToken: z.boolean().optional(),
});

export type SettingsSaveInput = z.infer<typeof settingsSaveInputSchema>;

export const secretsStatusSchema = z.object({
  encryptionAvailable: z.boolean(),
  storageBackend: z.string(),
  freshdeskApiKeyPresent: z.boolean(),
  wssDeviceTokenPresent: z.boolean(),
  /** Human-readable limitation when vault cannot protect secrets. */
  limitation: z.string().nullable(),
});

export type SecretsStatus = z.infer<typeof secretsStatusSchema>;

export const connectionStateSchema = z.enum([
  'disconnected',
  'connecting',
  'authenticating',
  'connected',
  'reconnecting',
  'error',
  'mock',
]);

export type ConnectionState = z.infer<typeof connectionStateSchema>;

export const connectionStatusSchema = z.object({
  state: connectionStateSchema,
  mockMode: z.boolean(),
  lastError: z.string().nullable(),
  lastConnectedAt: z.string().nullable(),
  queueDepth: z.number().int().nonnegative(),
});

export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const ticketParseInputSchema = z.object({
  input: z.string().min(1).max(2048),
});

export const ticketParseResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    ticketId: z.number().int().positive(),
    source: z.enum(['id', 'url']),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
  }),
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
  z.object({
    ok: z.literal(true),
    ticket: ticketDetailSchema,
  }),
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
  /** INTERNAL_NOTE when private and included; otherwise PUBLIC. */
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

/**
 * Chat send identity invariant: outer ticketKey/contextRevision must match the
 * sanitized context payload. Main-process validation enforces this even if the
 * renderer briefly holds mismatched UI state during a ticket switch.
 */
export const chatSendInputSchema = z
  .object({
    ticketKey: ticketKeySchema,
    contextRevision: z.number().int().positive(),
    sanitizedContext: sanitizedContextSchema,
    userMessage: z.string().min(1).max(16_000),
    /** Client-side idempotency key to block duplicate submissions. */
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

export const chatCancelInputSchema = z.object({
  requestId: z.string().uuid(),
});

export const chatEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('queued'),
    requestId: z.string().uuid(),
    position: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('delta'),
    requestId: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    text: z.string(),
  }),
  z.object({
    type: z.literal('completed'),
    requestId: z.string().uuid(),
    text: z.string(),
  }),
  z.object({
    type: z.literal('failed'),
    requestId: z.string().uuid(),
    error: z.string(),
    code: z.string(),
  }),
]);

export type ChatEvent = z.infer<typeof chatEventSchema>;

export const testConnectionResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    message: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
  }),
]);

export type TestConnectionResult = z.infer<typeof testConnectionResultSchema>;

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  isPackaged: z.boolean(),
  mockBrokerDefault: z.boolean(),
});

export type AppInfo = z.infer<typeof appInfoSchema>;
