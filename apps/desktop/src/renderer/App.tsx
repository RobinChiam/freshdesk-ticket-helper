/**
 * Root application shell: provider settings and ticket-scoped workspace.
 *
 * Ticket/context identity invariant: sanitized context and chat state are bound to the
 * current ticketKey. On ticket change we clear previous context immediately and only
 * enable send when sanitized.ticketKey matches the loaded ticket. Main-process schema
 * also rejects mismatched chat payloads.
 */
import { useEffect, useState } from 'react';

import type {
  NonSecretSettings,
  RecentTicket,
  SanitizedContext,
  SecretsStatus,
  TicketDetail,
} from '@fth/protocol';

import { ChatPanel } from './components/ChatPanel';
import { isAiConfigured, ProviderBadge } from './components/ProviderBadge';
import { RecentTickets } from './components/RecentTickets';
import { SanitizerPreview } from './components/SanitizerPreview';
import { SettingsForm } from './components/SettingsForm';
import { TicketTimeline } from './components/TicketTimeline';
import { StatusBanner } from './components/StatusBanner';
import { TicketWorkspace } from './components/TicketWorkspace';
import { selectSanitizedForTicket } from './ticketContextGuard';

type LoadState = 'loading' | 'ready' | 'error';

export function App() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<NonSecretSettings | null>(null);
  const [secrets, setSecrets] = useState<SecretsStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [ticketInput, setTicketInput] = useState('8812');
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [recent, setRecent] = useState<RecentTicket[]>([]);
  const [sanitized, setSanitized] = useState<SanitizedContext | null>(null);
  const [includePrivateNotes, setIncludePrivateNotes] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextSettings, nextSecrets, nextRecent] = await Promise.all([
          window.desktopApi.getSettings(),
          window.desktopApi.getSecretsStatus(),
          window.desktopApi.listRecentTickets(),
        ]);
        if (cancelled) return;
        setSettings(nextSettings);
        setSecrets(nextSecrets);
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

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ticket) {
      return;
    }
    const ticketKey = ticket.ticketKey;
    let cancelled = false;
    (async () => {
      try {
        const preview = await window.desktopApi.previewSanitizer({
          ticket,
          includePrivateNotes,
        });
        // Drop stale async results that belong to a previous ticket selection.
        if (!cancelled && preview.ticketKey === ticketKey) {
          setSanitized(preview);
          setPreviewError(null);
        }
      } catch {
        if (!cancelled) {
          setSanitized(null);
          setPreviewError('Could not prepare trusted AI context. Reopen the ticket and try again.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticket, includePrivateNotes]);

  // Only expose context that matches the currently selected ticket.
  const sanitizedForCurrentTicket = selectSanitizedForTicket(ticket?.ticketKey, sanitized);

  async function refreshRecent(): Promise<void> {
    setRecent(await window.desktopApi.listRecentTickets());
  }

  async function handleOpenTicket(rawInput?: string): Promise<void> {
    const input = (rawInput ?? ticketInput).trim();
    setTicketLoading(true);
    setTicketError(null);
    setPreviewError(null);
    // Clear previous ticket context/chat immediately to prevent cross-ticket leakage.
    setTicket(null);
    setSanitized(null);
    try {
      const result = await window.desktopApi.openTicket(input);
      if (!result.ok) {
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
    if (settings && settings.freshdeskUrl !== next.settings.freshdeskUrl) {
      setTicket(null);
      setSanitized(null);
    }
    setSettings(next.settings);
    setSecrets(next.secrets);
    setIncludePrivateNotes(next.settings.includePrivateNotesInAi);
    setShowSettings(!next.settings.onboardingComplete);
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
          <ProviderBadge settings={settings} secrets={secrets} />
          <button type="button" className="ghost" onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? 'Back to workspace' : 'Settings'}
          </button>
        </div>
      </header>

      {secrets.limitation ? (
        <StatusBanner
          tone="warning"
          title="Secret storage limitation"
          message={secrets.limitation}
        />
      ) : null}

      {showSettings ? (
        <SettingsForm settings={settings} secrets={secrets} onSaved={handleSettingsSaved} />
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
                <button
                  type="button"
                  onClick={() => void handleOpenTicket()}
                  disabled={ticketLoading}
                >
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
              <StatusBanner
                tone="info"
                title="Loading ticket"
                message="Fetching ticket and conversations…"
              />
            ) : null}

            {ticket ? (
              <TicketWorkspace key={ticket.ticketKey}>
                <TicketTimeline
                  ticket={ticket}
                  includePrivateNotes={includePrivateNotes}
                  onIncludePrivateNotesChange={async (value) => {
                    setPreferenceError(null);
                    try {
                      const saved = await window.desktopApi.saveSettings({
                        ...settings,
                        includePrivateNotesInAi: value,
                      });
                      setSettings(saved.settings);
                      setIncludePrivateNotes(saved.settings.includePrivateNotesInAi);
                    } catch (error) {
                      setPreferenceError(
                        error instanceof Error
                          ? error.message
                          : 'Could not save private-note preference.',
                      );
                    }
                  }}
                />
                {preferenceError ? (
                  <StatusBanner
                    tone="error"
                    title="Preference not saved"
                    message={preferenceError}
                  />
                ) : null}
                {previewError ? (
                  <StatusBanner
                    tone="error"
                    title="Context preparation failed"
                    message={previewError}
                  />
                ) : null}
                <SanitizerPreview context={sanitizedForCurrentTicket} />
                <ChatPanel
                  key={ticket.ticketKey}
                  ticketKey={ticket.ticketKey}
                  sanitized={sanitizedForCurrentTicket}
                  aiConfigured={isAiConfigured(settings, secrets)}
                />
              </TicketWorkspace>
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}
