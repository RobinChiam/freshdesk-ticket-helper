import type { NonSecretSettings, SecretsStatus } from '@fth/protocol';

export function isAiConfigured(settings: NonSecretSettings, secrets: SecretsStatus): boolean {
  const connection = settings.aiConnection;
  if (connection.kind === 'subscription-cli') {
    // CLI mode needs no API key; readiness is confirmed via Check installation / Test connection.
    return true;
  }
  return Boolean(
    connection.modelId.trim() &&
    secrets.aiProviderKeyPresent[connection.provider] &&
    (connection.provider !== 'openai-compatible' || connection.customBaseUrl),
  );
}

export function ProviderBadge({
  settings,
  secrets,
}: {
  settings: NonSecretSettings;
  secrets: SecretsStatus;
}) {
  const connection = settings.aiConnection;
  const ready = isAiConfigured(settings, secrets);
  if (connection.kind === 'subscription-cli') {
    return (
      <span className="badge">
        AI: CLI · {connection.adapter}
        {connection.modelId.trim() ? ` · ${connection.modelId}` : ready ? '' : ' · setup needed'}
      </span>
    );
  }
  return (
    <span className="badge">
      AI: {connection.provider}
      {ready ? ` · ${connection.modelId}` : ' · setup needed'}
    </span>
  );
}
