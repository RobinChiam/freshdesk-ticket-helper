/**
 * Authenticated WebSocket Secure message schemas for the VPS AI broker.
 * Desktop main process is the only process allowed to speak this protocol.
 */
import { z } from 'zod';

import {
  PROTOCOL_VERSION,
  isoTimestampSchema,
  protocolVersionSchema,
  requestIdSchema,
  ticketKeySchema,
} from './common.js';
import { sanitizedContextSchema } from './ipc.js';

export { PROTOCOL_VERSION };

const envelopeBase = z.object({
  protocolVersion: protocolVersionSchema,
  requestId: requestIdSchema,
  ticketKey: ticketKeySchema.nullable(),
  timestamp: isoTimestampSchema,
});

export const wssMessageTypeSchema = z.enum([
  'auth',
  'auth.result',
  'context.sync',
  'context.ack',
  'chat.request',
  'chat.queued',
  'chat.delta',
  'chat.completed',
  'chat.failed',
  'chat.cancel',
  'ping',
  'pong',
  'error',
]);

export type WssMessageType = z.infer<typeof wssMessageTypeSchema>;

export const authPayloadSchema = z.object({
  deviceToken: z.string().min(1).max(4096),
  clientName: z.string().default('freshdesk-ticket-helper'),
  clientVersion: z.string(),
});

export const authResultPayloadSchema = z.object({
  ok: z.boolean(),
  sessionId: z.string().optional(),
  error: z.string().optional(),
});

export const contextSyncPayloadSchema = z.object({
  contextRevision: z.number().int().positive(),
  context: sanitizedContextSchema,
});

export const chatRequestPayloadSchema = z.object({
  contextRevision: z.number().int().positive(),
  /** User chat text only — never raw ticket HTML or unsanitized notes. */
  userMessage: z.string().min(1).max(16_000),
  clientRequestKey: z.string().uuid(),
});

export const chatQueuedPayloadSchema = z.object({
  position: z.number().int().nonnegative(),
});

export const chatDeltaPayloadSchema = z.object({
  sequence: z.number().int().nonnegative(),
  text: z.string(),
});

export const chatCompletedPayloadSchema = z.object({
  text: z.string(),
  sequenceEnd: z.number().int().nonnegative(),
});

export const chatFailedPayloadSchema = z.object({
  code: z.string(),
  error: z.string(),
});

export const pingPayloadSchema = z.object({
  nonce: z.string().min(1).max(128),
});

export const pongPayloadSchema = z.object({
  nonce: z.string().min(1).max(128),
});

export const errorPayloadSchema = z.object({
  code: z.string(),
  error: z.string(),
});

export const wssMessageSchema = z.discriminatedUnion('type', [
  envelopeBase.extend({
    type: z.literal('auth'),
    payload: authPayloadSchema,
  }),
  envelopeBase.extend({
    type: z.literal('auth.result'),
    payload: authResultPayloadSchema,
  }),
  envelopeBase.extend({
    type: z.literal('context.sync'),
    payload: contextSyncPayloadSchema,
  }),
  envelopeBase.extend({
    type: z.literal('context.ack'),
    payload: z.object({ contextRevision: z.number().int().positive() }),
  }),
  envelopeBase.extend({
    type: z.literal('chat.request'),
    payload: chatRequestPayloadSchema,
  }),
  envelopeBase.extend({
    type: z.literal('chat.queued'),
    payload: chatQueuedPayloadSchema,
  }),
  envelopeBase.extend({
    type: z.literal('chat.delta'),
    payload: chatDeltaPayloadSchema,
  }),
  envelopeBase.extend({
    type: z.literal('chat.completed'),
    payload: chatCompletedPayloadSchema,
  }),
  envelopeBase.extend({
    type: z.literal('chat.failed'),
    payload: chatFailedPayloadSchema,
  }),
  envelopeBase.extend({
    type: z.literal('chat.cancel'),
    payload: z.object({}),
  }),
  envelopeBase.extend({
    type: z.literal('ping'),
    payload: pingPayloadSchema,
  }),
  envelopeBase.extend({
    type: z.literal('pong'),
    payload: pongPayloadSchema,
  }),
  envelopeBase.extend({
    type: z.literal('error'),
    payload: errorPayloadSchema,
  }),
]);

export type WssMessage = z.infer<typeof wssMessageSchema>;

/** Helper to build a typed outbound envelope with required metadata. */
export function createWssEnvelope<T extends WssMessage['type']>(
  type: T,
  args: {
    requestId: string;
    ticketKey: string | null;
    payload: Extract<WssMessage, { type: T }>['payload'];
    timestamp?: string;
  },
): Extract<WssMessage, { type: T }> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type,
    requestId: args.requestId,
    ticketKey: args.ticketKey,
    timestamp: args.timestamp ?? new Date().toISOString(),
    payload: args.payload,
  } as Extract<WssMessage, { type: T }>;
}
