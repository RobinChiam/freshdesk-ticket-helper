/**
 * First-run / settings form for Freshdesk + WSS configuration.
 * Never displays stored secret values — only presence indicators.
 */
import { useState } from 'react';

import type { NonSecretSettings, SecretsStatus, SettingsSaveInput } from '@fth/protocol';

import { StatusBanner } from './StatusBanner';

type Props = {
  settings: NonSecretSettings;
  secrets: SecretsStatus;
  onSaved: (next: { settings: NonSecretSettings; secrets: SecretsStatus }) => void | Promise<void>;
};

export function SettingsForm({ settings, secrets, onSaved }: Props) {
  const [freshdeskUrl, setFreshdeskUrl] = useState(settings.freshdeskUrl);
  const [freshdeskUiHosts, setFreshdeskUiHosts] = useState(settings.freshdeskUiHosts.join(', '));
  const [freshdeskApiKey, setFreshdeskApiKey] = useState('');
  const [wssUrl, setWssUrl] = useState(settings.wssUrl);
  const [wssDeviceToken, setWssDeviceToken] = useState('');
  const [useMockBroker, setUseMockBroker] = useState(settings.useMockBroker);
  const [includePrivateNotesInAi, setIncludePrivateNotesInAi] = useState(
    settings.includePrivateNotesInAi,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fdTest, setFdTest] = useState<string | null>(null);
  const [wssTest, setWssTest] = useState<string | null>(null);

  async function save(markComplete: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload: SettingsSaveInput = {
        freshdeskUrl: freshdeskUrl.trim(),
        freshdeskUiHosts: freshdeskUiHosts
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
        wssUrl: wssUrl.trim(),
        useMockBroker,
        includePrivateNotesInAi,
        onboardingComplete: markComplete ? true : settings.onboardingComplete,
      };
      if (freshdeskApiKey.trim()) {
        payload.freshdeskApiKey = freshdeskApiKey.trim();
      }
      if (wssDeviceToken.trim()) {
        payload.wssDeviceToken = wssDeviceToken.trim();
      }
      const saved = await window.desktopApi.saveSettings(payload);
      setFreshdeskApiKey('');
      setWssDeviceToken('');
      setMessage('Settings saved. Secrets are stored in the OS credential vault when available.');
      await onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setBusy(false);
    }
  }

  async function testFreshdesk(): Promise<void> {
    setFdTest(null);
    await save(false);
    const result = await window.desktopApi.testFreshdesk();
    setFdTest(result.ok ? result.message : result.error);
  }

  async function testWss(): Promise<void> {
    setWssTest(null);
    await save(false);
    const result = await window.desktopApi.testWss();
    setWssTest(result.ok ? result.message : result.error);
  }

  return (
    <section className="panel settings-panel">
      <h2>{settings.onboardingComplete ? 'Settings' : 'First-run configuration'}</h2>
      <p className="muted">
        Configure Freshdesk and the public WSS AI broker. The app never asks for SSH credentials —
        SSH is only for administrators deploying the VPS outside this application.
      </p>

      <div className="form-grid">
        <label>
          Freshdesk account URL
          <input
            value={freshdeskUrl}
            onChange={(e) => setFreshdeskUrl(e.target.value)}
            placeholder="https://company.freshdesk.com"
            autoComplete="off"
          />
        </label>
        <label>
          Optional UI host allowlist (comma-separated)
          <input
            value={freshdeskUiHosts}
            onChange={(e) => setFreshdeskUiHosts(e.target.value)}
            placeholder="support.company.com"
            autoComplete="off"
          />
        </label>
        <label>
          Freshdesk API key {secrets.freshdeskApiKeyPresent ? '(saved in vault)' : '(not saved)'}
          <input
            type="password"
            value={freshdeskApiKey}
            onChange={(e) => setFreshdeskApiKey(e.target.value)}
            placeholder={secrets.freshdeskApiKeyPresent ? '•••••••• (leave blank to keep)' : 'Enter API key'}
            autoComplete="off"
          />
        </label>
        <div className="row">
          <button type="button" onClick={() => void testFreshdesk()} disabled={busy}>
            Test Freshdesk connection
          </button>
          {fdTest ? <span className="muted">{fdTest}</span> : null}
        </div>

        <label>
          Public WSS URL
          <input
            value={wssUrl}
            onChange={(e) => setWssUrl(e.target.value)}
            placeholder="wss://ai-helper.example.com/ws"
            autoComplete="off"
          />
        </label>
        <label>
          Device / pairing token {secrets.wssDeviceTokenPresent ? '(saved in vault)' : '(not saved)'}
          <input
            type="password"
            value={wssDeviceToken}
            onChange={(e) => setWssDeviceToken(e.target.value)}
            placeholder={secrets.wssDeviceTokenPresent ? '•••••••• (leave blank to keep)' : 'Enter pairing token'}
            autoComplete="off"
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={useMockBroker}
            onChange={(e) => setUseMockBroker(e.target.checked)}
          />
          Use mock AI broker (recommended until the VPS endpoint is ready)
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includePrivateNotesInAi}
            onChange={(e) => setIncludePrivateNotesInAi(e.target.checked)}
          />
          Include private notes in AI context (default off)
        </label>
        <div className="row">
          <button type="button" onClick={() => void testWss()} disabled={busy}>
            Test AI server connection
          </button>
          {wssTest ? <span className="muted">{wssTest}</span> : null}
        </div>
      </div>

      {includePrivateNotesInAi ? (
        <StatusBanner
          tone="warning"
          title="Private notes will be sent to the AI broker when enabled"
          message="Internal notes must not be disclosed in customer-facing drafts."
        />
      ) : null}

      {message ? <StatusBanner tone="success" title="Saved" message={message} /> : null}
      {error ? <StatusBanner tone="error" title="Save failed" message={error} /> : null}

      <div className="row">
        <button type="button" onClick={() => void save(true)} disabled={busy}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() =>
            void window.desktopApi.saveSettings({
              ...settings,
              clearFreshdeskApiKey: true,
              clearWssDeviceToken: true,
            }).then(onSaved)
          }
        >
          Clear stored secrets
        </button>
      </div>
    </section>
  );
}
