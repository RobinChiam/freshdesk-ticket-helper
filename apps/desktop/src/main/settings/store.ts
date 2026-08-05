/** Non-secret settings persisted in SQLite. API keys live only in SecretVault. */
import { aiConnectionSchema, nonSecretSettingsSchema, type NonSecretSettings } from '@fth/protocol';

import type { AppDatabase } from '../../database/index.js';

const SETTINGS_KEY = 'non_secret_settings_v3';
const LEGACY_V2_KEY = 'non_secret_settings_v2';
const LEGACY_V1_KEY = 'non_secret_settings_v1';

export const DEFAULT_SETTINGS: NonSecretSettings = {
  freshdeskUrl: '',
  freshdeskUiHosts: [],
  includePrivateNotesInAi: false,
  onboardingComplete: false,
  aiConnection: {
    kind: 'api-key',
    provider: 'google',
    modelId: '',
    customBaseUrl: '',
  },
};

export function loadSettings(db: AppDatabase): NonSecretSettings {
  const current = parseSettings(db.getSetting(SETTINGS_KEY));
  if (current) {
    db.deleteSetting(LEGACY_V2_KEY);
    db.deleteSetting(LEGACY_V1_KEY);
    return current;
  }

  const fromV2 = migrateV2Settings(db.getSetting(LEGACY_V2_KEY));
  if (fromV2) {
    saveSettings(db, fromV2);
    db.deleteSetting(LEGACY_V2_KEY);
    db.deleteSetting(LEGACY_V1_KEY);
    return fromV2;
  }

  const fromV1 = migrateLegacyV1Settings(db.getSetting(LEGACY_V1_KEY));
  if (fromV1) {
    saveSettings(db, fromV1);
    db.deleteSetting(LEGACY_V1_KEY);
    return fromV1;
  }
  return { ...DEFAULT_SETTINGS, aiConnection: { ...DEFAULT_SETTINGS.aiConnection } };
}

export function saveSettings(db: AppDatabase, settings: NonSecretSettings): NonSecretSettings {
  const parsed = nonSecretSettingsSchema.parse(settings);
  db.setSetting(SETTINGS_KEY, JSON.stringify(parsed));
  return parsed;
}

function parseSettings(raw: string | null): NonSecretSettings | null {
  if (!raw) return null;
  try {
    const parsed = nonSecretSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * v2 → v3: keep users in API-key mode with existing provider/model/URL intact.
 * Never invent a subscription-cli connection during migration.
 */
function migrateV2Settings(raw: string | null): NonSecretSettings | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const connection = aiConnectionSchema.parse({
      kind: 'api-key',
      provider: typeof value['aiProviderId'] === 'string' ? value['aiProviderId'] : 'google',
      modelId: typeof value['aiModelId'] === 'string' ? value['aiModelId'] : '',
      customBaseUrl: typeof value['customBaseUrl'] === 'string' ? value['customBaseUrl'] : '',
    });
    return nonSecretSettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      freshdeskUrl: typeof value['freshdeskUrl'] === 'string' ? value['freshdeskUrl'] : '',
      freshdeskUiHosts: Array.isArray(value['freshdeskUiHosts']) ? value['freshdeskUiHosts'] : [],
      includePrivateNotesInAi: value['includePrivateNotesInAi'] === true,
      onboardingComplete: value['onboardingComplete'] === true,
      aiConnection: connection,
    });
  } catch {
    return null;
  }
}

/** Carry forward only known non-secret Freshdesk preferences from broker-era settings. */
function migrateLegacyV1Settings(raw: string | null): NonSecretSettings | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return nonSecretSettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      freshdeskUrl: typeof value['freshdeskUrl'] === 'string' ? value['freshdeskUrl'] : '',
      freshdeskUiHosts: Array.isArray(value['freshdeskUiHosts']) ? value['freshdeskUiHosts'] : [],
      includePrivateNotesInAi: value['includePrivateNotesInAi'] === true,
      onboardingComplete: value['onboardingComplete'] === true,
    });
  } catch {
    return null;
  }
}
