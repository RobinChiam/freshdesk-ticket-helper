/** Local recent-ticket list backed by SQLite (extension point for assigned browser later). */
import type { RecentTicket } from '@fth/protocol';

export function RecentTickets({
  tickets,
  onSelect,
}: {
  tickets: RecentTicket[];
  onSelect: (ticket: RecentTicket) => void;
}) {
  return (
    <section className="panel">
      <h2>Recent tickets</h2>
      {tickets.length === 0 ? (
        <p className="muted">No recent tickets yet.</p>
      ) : (
        <ul className="recent-list">
          {tickets.map((ticket) => (
            <li key={ticket.ticketKey}>
              <button type="button" className="linkish" onClick={() => onSelect(ticket)}>
                <span className="recent-id">#{ticket.ticketId}</span>
                <span>{ticket.subject}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted tiny">
        Extension point: a future assigned/open ticket browser can plug in beside this list.
      </p>
    </section>
  );
}
