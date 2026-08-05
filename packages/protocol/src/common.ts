/** Shared identity schemas used by local persistence and IPC payloads. */
import { z } from 'zod';

export const requestIdSchema = z.string().uuid();
export const ticketKeySchema = z
  .string()
  .min(3)
  .max(256)
  .regex(/^[a-z0-9.-]+:\d+$/i, 'ticketKey must be host:ticketId');
export const isoTimestampSchema = z.string().datetime({ offset: true });

export type RequestId = z.infer<typeof requestIdSchema>;
export type TicketKey = z.infer<typeof ticketKeySchema>;
