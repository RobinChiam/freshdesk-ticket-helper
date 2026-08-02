/**
 * Non-secret settings persisted in SQLite.
 * API keys and device tokens are handled exclusively by SecretVault.
 */
import { nonSecretSettingsSchema, type NonSecretSettings } from '@fth/protocol';

import type { AppDatabase } from '../../database/index.js';

const SETTINGS_KEY = 'non_secret_settings_v1';

const DEFAULT_SETTINGS: NonSecretSettings = {
  freshdeskUrl: '',
  freshdeskUiHosts: [],
  wssUrl: '',
  useMockBroker: true,
  includePrivateNotesInAi: false,
  onboardingComplete: false,
};

export function loadSettings(db: AppDatabase): NonSecretSettings {
  const raw = db.getSetting(SETTINGS_KEY);
  if (!raw) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const parsed = nonSecretSettingsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return { ...DEFAULT_SETTINGS };
    }
    return parsed.data;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(db: AppDatabase, settings: NonSecretSettings): NonSecretSettings {
  const parsed = nonSecretSettingsSchema.parse(settings);
  db.setSetting(SETTINGS_KEY, JSON.stringify(parsed));
  return parsed;
}
