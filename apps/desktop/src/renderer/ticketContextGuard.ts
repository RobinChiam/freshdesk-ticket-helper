/**
 * Pure helpers for ticket/context identity checks (unit-testable without Electron).
 * Main process still enforces the same invariant via chatSendInputSchema.
 */
import type { SanitizedContext } from '@fth/protocol';

/** Return sanitized context only when it belongs to the currently selected ticket. */
export function selectSanitizedForTicket(
  ticketKey: string | null | undefined,
  sanitized: SanitizedContext | null | undefined,
): SanitizedContext | null {
  if (!ticketKey || !sanitized) {
    return null;
  }
  return sanitized.ticketKey === ticketKey ? sanitized : null;
}

/** Whether the renderer may attempt a chat send for the given selection. */
export function canSendWithContext(ticketKey: string, sanitized: SanitizedContext | null): boolean {
  return selectSanitizedForTicket(ticketKey, sanitized) != null;
}
