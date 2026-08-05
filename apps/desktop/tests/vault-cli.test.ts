/** Vault never receives CLI OAuth credentials; API keys remain provider-scoped. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8'),
    getSelectedStorageBackend: () => 'gnome_libsecret',
  },
}));

import { SecretVault } from '../src/main/secrets/vault';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SecretVault CLI isolation', () => {
  it('stores only API-key provider secrets and never a CLI credential slot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fth-vault-'));
    tempDirs.push(dir);
    const vault = new SecretVault(join(dir, 'secrets.vault'));
    vault.setAiApiKey('openai', 'api-key-only');
    const status = vault.getStatus();
    expect(status.aiProviderKeyPresent.openai).toBe(true);
    expect(status.aiProviderKeyPresent).not.toHaveProperty('codex');
    expect(status.aiProviderKeyPresent).not.toHaveProperty('cursor');
    expect(vault.getAiApiKey('openai')).toBe('api-key-only');
  });
});
