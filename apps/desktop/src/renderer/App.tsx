/**
 * Root application shell: first-run settings, ticket workspace, and connection status.
 */
import { useEffect, useState } from 'react';

import type {
  ConnectionStatus,
  NonSecretSettings,
  RecentTicket,
  SanitizedContext,
  SecretsStatus,
  TicketDetail,
} from '@fth/protocol';

import { ChatPanel } from './components/ChatPanel';
import { ConnectionBadge } from './components/ConnectionBadge';
import { RecentTickets } from './components/RecentTickets';
import { SanitizerPreview } from './components/SanitizerPreview';
import { SettingsForm } from './components/SettingsForm';
import { TicketTimeline } from './components/TicketTimeline';
import { StatusBanner } from './components/StatusBanner';

type LoadState = 'loading' | 'ready' | 'error';

export function App() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<NonSecretSettings | null>(null);
  const [secrets, setSecrets] = useState<SecretsStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [ticketInput, setTicketInput] = useState('8812');
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [recent, setRecent] = useState<RecentTicket[]>([]);
  const [sanitized, setSanitized] = useState<SanitizedContext | null>(null);
  const [includePrivateNotes, setIncludePrivateNotes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextSettings, nextSecrets, nextConnection, nextRecent] = await Promise.all([
          window.desktopApi.getSettings(),
          window.desktopApi.getSecretsStatus(),
          window.desktopApi.getConnectionStatus(),
          window.desktopApi.listRecentTickets(),
        ]);
        if (cancelled) return;
        setSettings(nextSettings);
        setSecrets(nextSecrets);
        setConnection(nextConnection);
        setRecent(nextRecent);
        setIncludePrivateNotes(nextSettings.includePrivateNotesInAi);
        setShowSettings(!nextSettings.onboardingComplete);
        setLoadState('ready');
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to start application.');
        setLoadState('error');
      }
    })();

    const offStatus = window.desktopApi.onConnectionStatus((status: ConnectionStatus) =>
      setConnection(status),
    );
    return () => {
      cancelled = true;
      offStatus();
    };
  }, []);

  useEffect(() => {
    if (!ticket) {
      return;
    }
    let cancelled = false;
    (async () => {
      const preview = await window.desktopApi.previewSanitizer({
        ticket,
        includePrivateNotes,
      });
      if (!cancelled) {
        setSanitized(preview);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticket, includePrivateNotes]);

  // Keep sanitized preview cleared when no ticket is loaded without syncing in an effect.
  const sanitizedView = ticket ? sanitized : null;

  async function refreshRecent(): Promise<void> {
    setRecent(await window.desktopApi.listRecentTickets());
  }

  async function handleOpenTicket(rawInput?: string): Promise<void> {
    const input = (rawInput ?? ticketInput).trim();
    setTicketLoading(true);
    setTicketError(null);
    try {
      const result = await window.desktopApi.openTicket(input);
      if (!result.ok) {
        setTicket(null);
        setTicketError(result.error);
        return;
      }
      setTicket(result.ticket);
      setTicketInput(String(result.ticket.id));
      await refreshRecent();
    } catch (error) {
      setTicketError(error instanceof Error ? error.message : 'Failed to open ticket.');
    } finally {
      setTicketLoading(false);
    }
  }

  async function handleSettingsSaved(next: {
    settings: NonSecretSettings;
    secrets: SecretsStatus;
  }): Promise<void> {
    setSettings(next.settings);
    setSecrets(next.secrets);
    setIncludePrivateNotes(next.settings.includePrivateNotesInAi);
    setShowSettings(!next.settings.onboardingComplete);
    setConnection(await window.desktopApi.getConnectionStatus());
  }

  if (loadState === 'loading') {
    return (
      <div className="app-shell centered">
        <StatusBanner tone="info" title="Loading" message="Starting Freshdesk Ticket Helper…" />
      </div>
    );
  }

  if (loadState === 'error' || !settings || !secrets) {
    return (
      <div className="app-shell centered">
        <StatusBanner
          tone="error"
          title="Startup error"
          message={loadError ?? 'Unknown startup failure.'}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Freshdesk Ticket Helper</p>
          <h1>Secure ticket context for AI assistance</h1>
        </div>
        <div className="header-actions">
          <ConnectionBadge status={connection} />
          <button type="button" className="ghost" onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? 'Back to workspace' : 'Settings'}
          </button>
        </div>
      </header>

      {connection?.mockMode ? (
        <div className="mock-banner" role="status">
          Mock AI broker is active — responses are simulated and not from the VPS.
        </div>
      ) : null}

      {secrets.limitation ? (
        <StatusBanner
          tone="warning"
          title="Secret storage limitation"
          message={secrets.limitation}
        />
      ) : null}

      {showSettings ? (
        <SettingsForm
          settings={settings}
          secrets={secrets}
          onSaved={handleSettingsSaved}
        />
      ) : (
        <main className="workspace">
          <aside className="sidebar">
            <section className="panel">
              <h2>Open ticket</h2>
              <p className="muted">
                Accepts a numeric ID, a Freshdesk ticket URL from your configured host, or{' '}
                <code>demo</code> for a local sample ticket.
              </p>
              <div className="row">
                <input
                  value={ticketInput}
                  onChange={(e) => setTicketInput(e.target.value)}
                  placeholder="8812 or https://company.freshdesk.com/a/tickets/8812"
                  aria-label="Ticket ID or URL"
                />
                <button type="button" onClick={() => void handleOpenTicket()} disabled={ticketLoading}>
                  {ticketLoading ? 'Opening…' : 'Open'}
                </button>
              </div>
              {ticketError ? (
                <StatusBanner tone="error" title="Could not open ticket" message={ticketError} />
              ) : null}
            </section>

            <RecentTickets
              tickets={recent}
              onSelect={(item) => {
                setTicketInput(String(item.ticketId));
                void handleOpenTicket(String(item.ticketId));
              }}
            />
          </aside>

          <section className="content">
            {!ticket && !ticketLoading ? (
              <StatusBanner
                tone="info"
                title="No ticket loaded"
                message="Enter a ticket ID or URL to fetch metadata and conversations from Freshdesk."
              />
            ) : null}

            {ticketLoading ? (
              <StatusBanner tone="info" title="Loading ticket" message="Fetching ticket and conversations…" />
            ) : null}

            {ticket ? (
              <>
                <TicketTimeline
                  ticket={ticket}
                  includePrivateNotes={includePrivateNotes}
                  onIncludePrivateNotesChange={async (value) => {
                    setIncludePrivateNotes(value);
                    const saved = await window.desktopApi.saveSettings({
                      ...settings,
                      includePrivateNotesInAi: value,
                    });
                    setSettings(saved.settings);
                  }}
                />
                <SanitizerPreview context={sanitizedView} />
                <ChatPanel
                  ticketKey={ticket.ticketKey}
                  sanitized={sanitizedView}
                  connection={connection}
                />
              </>
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}
