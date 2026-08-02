/**
 * AI chat panel with streaming deltas, queue status, and cancellation.
 * Uses UUID clientRequestKey to block duplicate submissions.
 */
import { useEffect, useState } from 'react';

import type { ChatEvent, ConnectionStatus, SanitizedContext } from '@fth/protocol';

import { StatusBanner } from './StatusBanner';

function newUuid(): string {
  return crypto.randomUUID();
}

export function ChatPanel({
  ticketKey,
  sanitized,
  connection,
}: {
  ticketKey: string;
  sanitized: SanitizedContext | null;
  connection: ConnectionStatus | null;
}) {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queueNote, setQueueNote] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);

  useEffect(() => {
    return window.desktopApi.onChatEvent((event: ChatEvent) => {
      if (requestId && event.requestId !== requestId) {
        return;
      }
      if (event.type === 'queued') {
        setQueueNote(`Queued at position ${event.position}`);
      }
      if (event.type === 'delta') {
        setStreaming((prev) => prev + event.text);
      }
      if (event.type === 'completed') {
        setHistory((prev) => [...prev, { role: 'assistant', text: event.text }]);
        setStreaming('');
        setRequestId(null);
        setQueueNote(null);
      }
      if (event.type === 'failed') {
        setError(event.error);
        setStreaming('');
        setRequestId(null);
        setQueueNote(null);
      }
    });
  }, [requestId]);

  async function send(): Promise<void> {
    if (!sanitized || !input.trim() || requestId) {
      return;
    }
    setError(null);
    setQueueNote(null);
    setStreaming('');
    const userMessage = input.trim();
    setHistory((prev) => [...prev, { role: 'user', text: userMessage }]);
    setInput('');

    const result = await window.desktopApi.sendChat({
      ticketKey,
      contextRevision: sanitized.contextRevision,
      sanitizedContext: sanitized,
      userMessage,
      clientRequestKey: newUuid(),
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRequestId(result.requestId);
  }

  async function cancel(): Promise<void> {
    if (!requestId) return;
    await window.desktopApi.cancelChat(requestId);
    setRequestId(null);
    setQueueNote('Cancelled');
  }

  return (
    <section className="panel">
      <div className="chat-header">
        <h2>AI chat</h2>
        <p className="muted">
          Status: {connection?.state ?? 'unknown'}
          {connection?.mockMode ? ' (mock)' : ''}
          {connection?.queueDepth ? ` · queue ${connection.queueDepth}` : ''}
        </p>
      </div>

      {!sanitized ? (
        <StatusBanner
          tone="info"
          title="Waiting for context"
          message="Sanitized context is required before chatting."
        />
      ) : null}

      <div className="chat-log">
        {history.length === 0 && !streaming ? (
          <p className="muted">Ask a question about the sanitized ticket context.</p>
        ) : null}
        {history.map((item, index) => (
          <div key={`${item.role}-${index}`} className={`chat-bubble chat-${item.role}`}>
            <strong>{item.role === 'user' ? 'You' : 'Assistant'}</strong>
            <pre>{item.text}</pre>
          </div>
        ))}
        {streaming ? (
          <div className="chat-bubble chat-assistant">
            <strong>Assistant (streaming)</strong>
            <pre>{streaming}</pre>
          </div>
        ) : null}
      </div>

      {queueNote ? <p className="muted">{queueNote}</p> : null}
      {error ? <StatusBanner tone="error" title="Chat error" message={error} /> : null}

      <div className="row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this ticket…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void send();
            }
          }}
          disabled={!sanitized || Boolean(requestId)}
        />
        <button type="button" onClick={() => void send()} disabled={!sanitized || Boolean(requestId)}>
          Send
        </button>
        <button type="button" className="ghost" onClick={() => void cancel()} disabled={!requestId}>
          Cancel
        </button>
      </div>
    </section>
  );
}
