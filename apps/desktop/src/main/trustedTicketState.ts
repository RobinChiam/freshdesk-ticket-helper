/**
 * Main-process cache for Freshdesk responses and their sanitized revisions.
 * The renderer is untrusted, so provider requests resolve context from this cache
 * rather than accepting renderer-supplied ticket text as authoritative.
 */
import type { SanitizedContext, TicketDetail } from '@fth/protocol';

import { buildSanitizedContext } from '../sanitizer/index.js';

export class TrustedTicketState {
  private readonly tickets = new Map<string, TicketDetail>();
  private readonly contexts = new Map<string, SanitizedContext>();

  constructor(private readonly limit = 50) {}

  rememberTicket(ticket: TicketDetail): void {
    this.setBounded(this.tickets, ticket.ticketKey, ticket);
    this.contexts.delete(ticket.ticketKey);
  }

  hasTicket(ticketKey: string): boolean {
    return this.tickets.has(ticketKey);
  }

  buildContext(
    ticketKey: string,
    includePrivateNotes: boolean,
    contextRevision: number,
  ): SanitizedContext | null {
    const ticket = this.tickets.get(ticketKey);
    if (!ticket) return null;
    const context = buildSanitizedContext({ ticket, includePrivateNotes, contextRevision });
    this.setBounded(this.contexts, ticketKey, context);
    return context;
  }

  getContext(ticketKey: string, contextRevision: number): SanitizedContext | null {
    const context = this.contexts.get(ticketKey);
    return context?.contextRevision === contextRevision ? context : null;
  }

  clearContexts(): void {
    this.contexts.clear();
  }

  clear(): void {
    this.tickets.clear();
    this.contexts.clear();
  }

  private setBounded<T>(map: Map<string, T>, key: string, value: T): void {
    // Refresh insertion order so actively used tickets are retained.
    map.delete(key);
    map.set(key, value);
    while (map.size > this.limit) {
      const oldest = map.keys().next().value as string | undefined;
      if (!oldest) break;
      map.delete(oldest);
    }
  }
}
