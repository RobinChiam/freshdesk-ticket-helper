/**
 * Ticket-scoped workspace wrapper. Remounts children when key={ticketKey} changes
 * so chat/sanitizer state cannot accidentally survive a ticket switch.
 */
import type { ReactNode } from 'react';

export function TicketWorkspace({ children }: { children: ReactNode }) {
  return <div className="ticket-workspace">{children}</div>;
}
