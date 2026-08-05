/** Provider and Freshdesk configuration. Stored secret values are never displayed. */
import { useState } from 'react';

import type {
  AiConnection,
  AiProviderId,
  CliAdapterId,
  CliCheckResult,
  CliInstallStatus,
  NonSecretSettings,
  SecretsStatus,
  SettingsSaveInput,
} from '@fth/protocol';

import { StatusBanner } from './StatusBanner';

type Props = {
  settings: NonSecretSettings;
  secrets: SecretsStatus;
  onSaved: (next: { settings: NonSecretSettings; secrets: SecretsStatus }) => void | Promise<void>;
};

const PROVIDERS: Array<{ id: AiProviderId; label: string }> = [
  { id: 'google', label: 'Google Gemini' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai-compatible', label: 'Custom OpenAI-compatible' },
];

const CLI_ADAPTERS: Array<{ id: CliAdapterId; label: string; logical: string }> = [
  { id: 'antigravity', label: 'Google Antigravity CLI', logical: 'Google' },
  { id: 'codex', label: 'OpenAI Codex CLI', logical: 'OpenAI' },
  { id: 'claude-code', label: 'Anthropic Claude Code CLI', logical: 'Anthropic' },
];

const STATUS_LABELS: Record<CliInstallStatus, string> = {
  not_checked: 'Not checked',
  installed: 'Installed',
  installed_auth_unverified: 'Installed, authentication not verified',
  ready: 'Ready',
  missing: 'Missing',
  login_required: 'Login required',
  unsupported_version: 'Unsupported version',
  secure_automation_unsupported: 'Secure automation unsupported',
  test_timed_out: 'Test timed out',
  quota_rate_limited: 'Quota/rate limited',
  error: 'Error',
};

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Failed to save settings.';
  return message
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED]')
    .replace(/(api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
}

function initialConnection(settings: NonSecretSettings): AiConnection {
  return settings.aiConnection;
}

export function SettingsForm({ settings, secrets, onSaved }: Props) {
  const [freshdeskUrl, setFreshdeskUrl] = useState(settings.freshdeskUrl);
  const [freshdeskUiHosts, setFreshdeskUiHosts] = useState(settings.freshdeskUiHosts.join(', '));
  const [freshdeskApiKey, setFreshdeskApiKey] = useState('');
  const [connection, setConnection] = useState<AiConnection>(() => initialConnection(settings));
  const [aiApiKey, setAiApiKey] = useState('');
  const [includePrivateNotesInAi, setIncludePrivateNotesInAi] = useState(
    settings.includePrivateNotesInAi,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fdTest, setFdTest] = useState<string | null>(null);
  const [aiTest, setAiTest] = useState<string | null>(null);
  const [cliCheck, setCliCheck] = useState<CliCheckResult | null>(null);

  function basePayload(markComplete: boolean): SettingsSaveInput {
    return {
      freshdeskUrl: freshdeskUrl.trim(),
      freshdeskUiHosts: freshdeskUiHosts
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean),
      includePrivateNotesInAi,
      onboardingComplete: markComplete || settings.onboardingComplete,
      aiConnection: connection,
    };
  }

  async function save(
    markComplete: boolean,
    extras: Partial<SettingsSaveInput> = {},
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = { ...basePayload(markComplete), ...extras };
      // A clear action must win even when the password field still contains typed text.
      if (!payload.clearFreshdeskApiKey && freshdeskApiKey.trim()) {
        payload.freshdeskApiKey = freshdeskApiKey.trim();
      }
      if (connection.kind === 'api-key' && !payload.clearAiApiKey && aiApiKey.trim()) {
        payload.aiApiKey = aiApiKey.trim();
      }
      const saved = await window.desktopApi.saveSettings(payload);
      setFreshdeskApiKey('');
      setAiApiKey('');
      setConnection(saved.settings.aiConnection);
      setMessage('Settings saved. API keys remain encrypted in the OS credential vault.');
      await onSaved(saved);
      return true;
    } catch (caught) {
      setError(safeError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function testFreshdesk(): Promise<void> {
    setFdTest(null);
    if (!(await save(false))) return setFdTest('Save failed — test was not run.');
    const result = await window.desktopApi.testFreshdesk();
    setFdTest(result.ok ? result.message : result.error);
  }

  async function testAi(): Promise<void> {
    setAiTest(null);
    if (!(await save(false))) return setAiTest('Save failed — test was not run.');
    const result = await window.desktopApi.testAi();
    setAiTest(result.ok ? result.message : result.error);
  }

  async function clearFreshdeskKey(): Promise<void> {
    await save(false, { clearFreshdeskApiKey: true, freshdeskApiKey: undefined });
  }

  async function clearSelectedAiKey(): Promise<void> {
    if (connection.kind !== 'api-key') return;
    await save(false, { clearAiApiKey: true, aiApiKey: undefined });
  }

  async function checkInstallation(): Promise<void> {
    if (connection.kind !== 'subscription-cli') return;
    setBusy(true);
    setCliCheck(null);
    try {
      if (!(await save(false))) return;
      const result = await window.desktopApi.checkCli({
        adapter: connection.adapter,
        executablePath: connection.executablePath || undefined,
      });
      setCliCheck(result);
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function locateCli(): Promise<void> {
    if (connection.kind !== 'subscription-cli') return;
    setBusy(true);
    try {
      const result = await window.desktopApi.locateCli({ adapter: connection.adapter });
      if (!result.ok) {
        if (!result.cancelled) setError(result.error);
        return;
      }
      setConnection({ ...connection, executablePath: result.executablePath });
      setMessage('CLI executable path selected. Save settings to keep it.');
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function switchToApiKey(): void {
    const previousProvider =
      connection.kind === 'api-key'
        ? connection.provider
        : connection.adapter === 'antigravity'
          ? 'google'
          : connection.adapter === 'codex'
            ? 'openai'
            : 'anthropic';
    setConnection({
      kind: 'api-key',
      provider: previousProvider,
      modelId: connection.modelId,
      customBaseUrl: connection.kind === 'api-key' ? connection.customBaseUrl : '',
    });
    setCliCheck(null);
  }

  function switchToCli(): void {
    const adapter: CliAdapterId =
      connection.kind === 'subscription-cli'
        ? connection.adapter
        : connection.provider === 'openai' || connection.provider === 'openai-compatible'
          ? 'codex'
          : connection.provider === 'anthropic'
            ? 'claude-code'
            : 'antigravity';
    setConnection({
      kind: 'subscription-cli',
      adapter,
      modelId: connection.modelId,
      executablePath: connection.kind === 'subscription-cli' ? connection.executablePath : '',
    });
    setAiApiKey('');
    setCliCheck(null);
  }

  const selectedProvider =
    connection.kind === 'api-key'
      ? (PROVIDERS.find((provider) => provider.id === connection.provider)?.label ??
        connection.provider)
      : (CLI_ADAPTERS.find((adapter) => adapter.id === connection.adapter)?.label ??
        connection.adapter);
  const selectedKeyPresent =
    connection.kind === 'api-key' ? secrets.aiProviderKeyPresent[connection.provider] : false;

  return (
    <section className="panel settings-panel">
      <h2>{settings.onboardingComplete ? 'Settings' : 'First-run configuration'}</h2>
      <p className="muted">
        Freshdesk and AI requests run only in Electron&apos;s main process. API-key usage is billed
        by the selected provider under your API account. Subscription-CLI usage is governed by the
        installed CLI&apos;s current account, entitlement, and provider terms — consumer plans do
        not guarantee access.
      </p>

      <div className="form-grid">
        <h3>Freshdesk</h3>
        <label>
          Freshdesk account URL (https only)
          <input
            value={freshdeskUrl}
            onChange={(event) => setFreshdeskUrl(event.target.value)}
            placeholder="https://company.freshdesk.com"
            autoComplete="off"
          />
        </label>
        <label>
          Optional UI host allowlist (comma-separated)
          <input
            value={freshdeskUiHosts}
            onChange={(event) => setFreshdeskUiHosts(event.target.value)}
            placeholder="support.company.com"
            autoComplete="off"
          />
        </label>
        <label>
          Freshdesk API key {secrets.freshdeskApiKeyPresent ? '(saved in vault)' : '(not saved)'}
          <input
            type="password"
            value={freshdeskApiKey}
            onChange={(event) => setFreshdeskApiKey(event.target.value)}
            placeholder={
              secrets.freshdeskApiKeyPresent ? '•••••••• (leave blank to keep)' : 'Enter API key'
            }
            autoComplete="off"
          />
        </label>
        <div className="row">
          <button type="button" onClick={() => void testFreshdesk()} disabled={busy}>
            Test Freshdesk
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => void clearFreshdeskKey()}
            disabled={busy || !secrets.freshdeskApiKeyPresent}
          >
            Clear Freshdesk key
          </button>
          {fdTest ? <span className="muted">{fdTest}</span> : null}
        </div>

        <h3>AI connection</h3>
        <label>
          Connection method
          <select
            value={connection.kind}
            onChange={(event) => {
              if (event.target.value === 'api-key') switchToApiKey();
              else switchToCli();
            }}
          >
            <option value="api-key">API key</option>
            <option value="subscription-cli">Existing CLI subscription</option>
          </select>
        </label>

        {connection.kind === 'api-key' ? (
          <>
            <label>
              Provider
              <select
                value={connection.provider}
                onChange={(event) =>
                  setConnection({
                    ...connection,
                    provider: event.target.value as AiProviderId,
                  })
                }
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model ID
              <input
                value={connection.modelId}
                onChange={(event) => setConnection({ ...connection, modelId: event.target.value })}
                placeholder="Enter the exact model ID from your provider"
                autoComplete="off"
              />
            </label>
            {connection.provider === 'openai-compatible' ? (
              <label>
                OpenAI-compatible base URL (https only)
                <input
                  value={connection.customBaseUrl}
                  onChange={(event) =>
                    setConnection({ ...connection, customBaseUrl: event.target.value })
                  }
                  placeholder="https://provider.example.com/v1"
                  autoComplete="off"
                />
              </label>
            ) : null}
            <label>
              {selectedProvider} API key {selectedKeyPresent ? '(saved in vault)' : '(not saved)'}
              <input
                type="password"
                value={aiApiKey}
                onChange={(event) => setAiApiKey(event.target.value)}
                placeholder={
                  selectedKeyPresent ? '•••••••• (leave blank to keep)' : 'Enter API key'
                }
                autoComplete="off"
              />
            </label>
            <div className="row">
              <button type="button" onClick={() => void testAi()} disabled={busy}>
                Test AI provider
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void clearSelectedAiKey()}
                disabled={busy || !selectedKeyPresent}
              >
                Clear selected provider key
              </button>
              {aiTest ? <span className="muted">{aiTest}</span> : null}
            </div>
          </>
        ) : (
          <>
            <label>
              Subscription CLI
              <select
                value={connection.adapter}
                onChange={(event) => {
                  setConnection({
                    ...connection,
                    adapter: event.target.value as CliAdapterId,
                    executablePath: '',
                  });
                  setCliCheck(null);
                }}
              >
                {CLI_ADAPTERS.map((adapter) => (
                  <option key={adapter.id} value={adapter.id}>
                    {adapter.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted tiny">
              Logical provider:{' '}
              {CLI_ADAPTERS.find((adapter) => adapter.id === connection.adapter)?.logical}. The app
              assumes the CLI is already installed and authenticated. It never installs CLIs, runs
              login/logout, reads credential stores, or stores provider OAuth tokens.
            </p>
            <label>
              Optional model ID (when the CLI documents model selection)
              <input
                value={connection.modelId}
                onChange={(event) => setConnection({ ...connection, modelId: event.target.value })}
                placeholder="Leave blank to use the CLI default"
                autoComplete="off"
              />
            </label>
            <p className="muted tiny">
              Detected executable:{' '}
              {cliCheck?.executablePath ??
                (connection.executablePath.trim() ? connection.executablePath : 'Not checked yet')}
              {cliCheck?.version ? ` · ${cliCheck.version}` : ''}
            </p>
            {cliCheck ? (
              <p className="muted tiny">
                Status: {STATUS_LABELS[cliCheck.status]}. {cliCheck.message}
              </p>
            ) : (
              <p className="muted tiny">Status: Not checked</p>
            )}
            <div className="row">
              <button type="button" onClick={() => void checkInstallation()} disabled={busy}>
                Check installation
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void locateCli()}
                disabled={busy}
              >
                Locate CLI
              </button>
              <button type="button" onClick={() => void testAi()} disabled={busy}>
                Test connection
              </button>
              {aiTest ? <span className="muted">{aiTest}</span> : null}
            </div>
            <p className="muted tiny">
              A provider CLI may access Keychain, Credential Manager, or Secret Service as your user
              account, and the OS may show a consent prompt. Antigravity may open a browser when no
              saved login exists. Fix expired or missing logins in a terminal with the provider CLI
              — this app never requests elevation or automates login.
            </p>
          </>
        )}

        <label className="checkbox">
          <input
            type="checkbox"
            checked={includePrivateNotesInAi}
            onChange={(event) => setIncludePrivateNotesInAi(event.target.checked)}
          />
          Include private notes in AI context (default off)
        </label>
      </div>

      {includePrivateNotesInAi ? (
        <StatusBanner
          tone="warning"
          title="Private notes will be sent to the AI provider"
          message="Internal notes must not be disclosed in customer-facing drafts. Availability still depends on the Freshdesk API key’s agent permissions."
        />
      ) : null}
      {message ? <StatusBanner tone="success" title="Saved" message={message} /> : null}
      {error ? <StatusBanner tone="error" title="Save failed" message={error} /> : null}
      <button type="button" onClick={() => void save(true)} disabled={busy}>
        {busy ? 'Saving…' : 'Save and continue'}
      </button>
    </section>
  );
}
