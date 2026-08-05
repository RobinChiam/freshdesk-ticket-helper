/** Settings migration keeps API-key mode and drops broker-era data. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openAppDatabase } from '../src/database';
import { loadSettings } from '../src/main/settings/store';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('settings migration', () => {
  it('retains safe Freshdesk preferences and deletes the v1 broker record', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fth-settings-test-'));
    tempDirs.push(dir);
    const db = openAppDatabase(join(dir, 'state.sqlite'));
    db.setSetting(
      'non_secret_settings_v1',
      JSON.stringify({
        freshdeskUrl: 'https://company.freshdesk.com',
        freshdeskUiHosts: ['support.example.com'],
        includePrivateNotesInAi: true,
        onboardingComplete: true,
        wssUrl: 'wss://old.example.com',
        useMockBroker: true,
      }),
    );

    const settings = loadSettings(db);
    expect(settings).toMatchObject({
      freshdeskUrl: 'https://company.freshdesk.com',
      freshdeskUiHosts: ['support.example.com'],
      includePrivateNotesInAi: true,
    });
    expect(settings.aiConnection).toEqual({
      kind: 'api-key',
      provider: 'google',
      modelId: '',
      customBaseUrl: '',
    });
    expect(db.getSetting('non_secret_settings_v1')).toBeNull();
    expect(db.getSetting('non_secret_settings_v3')).not.toBeNull();
    db.close();
  });

  it('migrates v2 API-key settings into api-key connection without data loss', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fth-settings-v2-'));
    tempDirs.push(dir);
    const db = openAppDatabase(join(dir, 'state.sqlite'));
    db.setSetting(
      'non_secret_settings_v2',
      JSON.stringify({
        freshdeskUrl: 'https://acme.freshdesk.com',
        freshdeskUiHosts: [],
        includePrivateNotesInAi: false,
        onboardingComplete: true,
        aiProviderId: 'openai',
        aiModelId: 'gpt-4.1-mini',
        customBaseUrl: '',
      }),
    );

    const settings = loadSettings(db);
    expect(settings.aiConnection).toEqual({
      kind: 'api-key',
      provider: 'openai',
      modelId: 'gpt-4.1-mini',
      customBaseUrl: '',
    });
    expect(db.getSetting('non_secret_settings_v2')).toBeNull();
    expect(db.getSetting('non_secret_settings_v3')).not.toBeNull();
    db.close();
  });
});
