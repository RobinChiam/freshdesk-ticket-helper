/** Persistent, ticket-scoped AI chat with streamed responses and cancellation. */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChatEvent, ChatHistoryMessage, SanitizedContext } from '@fth/protocol';

import { StatusBanner } from './StatusBanner';

export function ChatPanel({
  ticketKey,
  sanitized,
  aiConfigured,
}: {
  ticketKey: string;
  sanitized: SanitizedContext | null;
  aiConfigured: boolean;
}) {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatHistoryMessage[]>([]);
  const contextReady = sanitized != null && sanitized.ticketKey === ticketKey;

  const reloadHistory = useCallback(async () => {
    setHistory(await window.desktopApi.listChatHistory(ticketKey));
  }, [ticketKey]);

  useEffect(() => {
    let disposed = false;
    // Resolve IPC first, then update React state so this effect only synchronizes
    // with the external SQLite-backed history source.
    void window.desktopApi
      .listChatHistory(ticketKey)
      .then((messages: ChatHistoryMessage[]) => {
        if (!disposed) setHistory(messages);
      })
      .catch(() => {
        if (!disposed) setError('Could not load local chat history.');
      });
    return () => {
      disposed = true;
      const active = requestIdRef.current;
      if (active) void window.desktopApi.cancelChat(active);
    };
  }, [ticketKey]);

  useEffect(
    () =>
      window.desktopApi.onChatEvent((event: ChatEvent) => {
        if (event.ticketKey !== ticketKey) return;
        const active = requestIdRef.current;
        if (active && event.requestId !== active) return;
        if (event.type === 'started') {
          setActivity('Generating response…');
        } else if (event.type === 'delta') {
          setStreaming((previous) => previous + event.text);
        } else if (event.type === 'completed') {
          setStreaming('');
          setRequestId(null);
          requestIdRef.current = null;
          setActivity(null);
          void reloadHistory();
        } else if (event.type === 'failed') {
          setError(event.error);
          setStreaming('');
          setRequestId(null);
          requestIdRef.current = null;
          setActivity(null);
          void reloadHistory();
        } else if (event.type === 'cancelled') {
          setStreaming('');
          setRequestId(null);
          requestIdRef.current = null;
          setActivity('Cancelled');
          void reloadHistory();
        }
      }),
    [reloadHistory, ticketKey],
  );

  async function send(): Promise<void> {
    if (!contextReady || !sanitized || !input.trim() || requestIdRef.current || !aiConfigured)
      return;
    setError(null);
    setActivity('Starting…');
    setStreaming('');
    const userMessage = input.trim();
    setInput('');
    try {
      const result = await window.desktopApi.sendChat({
        ticketKey,
        contextRevision: sanitized.contextRevision,
        sanitizedContext: sanitized,
        userMessage,
        clientRequestKey: crypto.randomUUID(),
      });
      if (!result.ok) {
        setError(result.error);
        setActivity(null);
        setInput(userMessage);
        return;
      }
      requestIdRef.current = result.requestId;
      setRequestId(result.requestId);
      await reloadHistory();
    } catch {
      setError('The chat request could not be started.');
      setActivity(null);
      setInput(userMessage);
    }
  }

  async function cancel(): Promise<void> {
    const active = requestIdRef.current;
    if (active) await window.desktopApi.cancelChat(active);
  }

  async function clearHistory(): Promise<void> {
    if (!window.confirm('Clear the local AI chat history for this ticket?')) return;
    try {
      await window.desktopApi.clearChatHistory(ticketKey);
      setHistory([]);
      setError(null);
    } catch {
      setError('Could not clear local chat history.');
    }
  }

  return (
    <section className="panel">
      <div className="chat-header">
        <h2>AI chat</h2>
        <button
          type="button"
          className="ghost"
          onClick={() => void clearHistory()}
          disabled={Boolean(requestId) || history.length === 0}
        >
          Clear history
        </button>
      </div>
      {!aiConfigured ? (
        <StatusBanner
          tone="warning"
          title="AI provider not configured"
          message="Choose a provider, enter a model ID, and store its API key in Settings."
        />
      ) : null}
      {!contextReady ? (
        <StatusBanner
          tone="info"
          title="Waiting for context"
          message="Sanitized context for this ticket is required before chatting."
        />
      ) : null}

      <div className="chat-log">
        {history.length === 0 && !streaming ? (
          <p className="muted">Ask a question about the sanitized ticket context.</p>
        ) : null}
        {history.map((item) => (
          <div key={item.id} className={`chat-bubble chat-${item.role}`}>
            <strong>{item.role === 'user' ? 'You' : 'Assistant'}</strong>
            <pre>{item.text}</pre>
            <small className="muted">
              {item.providerId} · {item.modelId}
            </small>
          </div>
        ))}
        {streaming ? (
          <div className="chat-bubble chat-assistant">
            <strong>Assistant (streaming)</strong>
            <pre>{streaming}</pre>
          </div>
        ) : null}
      </div>
      {activity ? <p className="muted">{activity}</p> : null}
      {error ? <StatusBanner tone="error" title="Chat error" message={error} /> : null}
      <div className="row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about this ticket…"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void send();
          }}
          disabled={!contextReady || !aiConfigured || Boolean(requestId)}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!contextReady || !aiConfigured || Boolean(requestId)}
        >
          Send
        </button>
        <button type="button" className="ghost" onClick={() => void cancel()} disabled={!requestId}>
          Cancel
        </button>
      </div>
    </section>
  );
}
