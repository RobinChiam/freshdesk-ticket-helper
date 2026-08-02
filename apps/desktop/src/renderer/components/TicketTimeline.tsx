/**
 * Ticket header + conversation timeline.
 * Renders plain text only — never inserts Freshdesk HTML via innerHTML.
 * Private notes are shown only when Freshdesk returned them for this API key’s permissions.
 */
import type { TicketDetail } from '@fth/protocol';

import { StatusBanner } from './StatusBanner';

export function TicketTimeline({
  ticket,
  includePrivateNotes,
  onIncludePrivateNotesChange,
}: {
  ticket: TicketDetail;
  includePrivateNotes: boolean;
  onIncludePrivateNotesChange: (value: boolean) => void | Promise<void>;
}) {
  return (
    <section className="panel">
      <div className="ticket-header">
        <div>
          <p className="eyebrow">Ticket #{ticket.id}</p>
          <h2>{ticket.subject}</h2>
          <p className="muted">
            Status {String(ticket.status)} · Priority {String(ticket.priority)} · Key{' '}
            {ticket.ticketKey}
          </p>
        </div>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={includePrivateNotes}
          onChange={(e) => void onIncludePrivateNotesChange(e.target.checked)}
        />
        Include private notes in AI context
      </label>

      {includePrivateNotes ? (
        <StatusBanner
          tone="warning"
          title="Private notes included"
          message="Internal notes are visible to the model. Do not disclose them in customer-facing drafts."
        />
      ) : null}

      <div className="timeline">
        <article className="message">
          <header>
            <span className="role">Description</span>
            <time>{ticket.createdAt}</time>
          </header>
          <pre className="message-body">{ticket.descriptionText || '(empty)'}</pre>
        </article>

        {ticket.conversations.map((message) => (
          <article
            key={message.id}
            className={`message ${message.private ? 'message-private' : ''}`}
          >
            <header>
              <span className="role">{message.role}</span>
              {message.private ? <span className="private-badge">Private note</span> : null}
              <time>{message.createdAt}</time>
            </header>
            <pre className="message-body">{message.bodyText || '(empty)'}</pre>
          </article>
        ))}
      </div>
    </section>
  );
}
