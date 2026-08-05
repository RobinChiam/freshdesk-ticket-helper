/**
 * Main-process wrapper around Electron safeStorage. This tracked source file contains
 * no credentials; the encrypted runtime vault is stored under Electron userData.
 */
import { safeStorage } from 'electron';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { AiProviderId } from '@fth/protocol';

const PROVIDERS: AiProviderId[] = ['google', 'openai', 'anthropic', 'openai-compatible'];

export type VaultStatus = {
  encryptionAvailable: boolean;
  storageBackend: string;
  freshdeskApiKeyPresent: boolean;
  aiProviderKeyPresent: Record<AiProviderId, boolean>;
  limitation: string | null;
};

type VaultFile = {
  freshdeskApiKey?: string;
  aiApiKeys?: Partial<Record<AiProviderId, string>>;
  /** Removed on first read/write after upgrading from the old WSS architecture. */
  wssDeviceToken?: string;
};

export class SecretVault {
  constructor(private readonly filePath: string) {
    if (existsSync(this.filePath)) chmodSync(this.filePath, 0o600);
    this.removeLegacyBrokerToken();
  }

  getStatus(): VaultStatus {
    const backend = this.getBackend();
    const limitation = this.describeLimitation(backend);
    const data = this.readEncryptedFile();
    return {
      encryptionAvailable: limitation === null && safeStorage.isEncryptionAvailable(),
      storageBackend: backend,
      freshdeskApiKeyPresent: Boolean(data.freshdeskApiKey),
      aiProviderKeyPresent: Object.fromEntries(
        PROVIDERS.map((provider) => [provider, Boolean(data.aiApiKeys?.[provider])]),
      ) as Record<AiProviderId, boolean>,
      limitation,
    };
  }

  getFreshdeskApiKey(): string | null {
    return this.decrypt(this.readEncryptedFile().freshdeskApiKey);
  }

  setFreshdeskApiKey(value: string): void {
    const data = this.readEncryptedFile();
    data.freshdeskApiKey = this.encrypt(value);
    this.writeEncryptedFile(data);
  }

  clearFreshdeskApiKey(): void {
    const data = this.readEncryptedFile();
    delete data.freshdeskApiKey;
    this.writeEncryptedFile(data);
  }

  getAiApiKey(provider: AiProviderId): string | null {
    return this.decrypt(this.readEncryptedFile().aiApiKeys?.[provider]);
  }

  setAiApiKey(provider: AiProviderId, value: string): void {
    const data = this.readEncryptedFile();
    data.aiApiKeys ??= {};
    data.aiApiKeys[provider] = this.encrypt(value);
    this.writeEncryptedFile(data);
  }

  clearAiApiKey(provider: AiProviderId): void {
    const data = this.readEncryptedFile();
    if (data.aiApiKeys) delete data.aiApiKeys[provider];
    this.writeEncryptedFile(data);
  }

  private removeLegacyBrokerToken(): void {
    const data = this.readEncryptedFile();
    if (!data.wssDeviceToken) return;
    delete data.wssDeviceToken;
    this.writeEncryptedFile(data);
  }

  private encrypt(value: string): string {
    this.assertCanStore();
    return safeStorage.encryptString(value).toString('base64');
  }

  private decrypt(encrypted?: string): string | null {
    if (!encrypted) return null;
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return null;
    }
  }

  private assertCanStore(): void {
    const limitation = this.describeLimitation(this.getBackend());
    if (limitation || !safeStorage.isEncryptionAvailable()) {
      throw new Error(
        limitation ?? 'Secure secret storage is unavailable. Credentials were not saved.',
      );
    }
  }

  private getBackend(): string {
    if (process.platform !== 'linux') return process.platform;
    try {
      return safeStorage.getSelectedStorageBackend();
    } catch {
      return 'unknown';
    }
  }

  private describeLimitation(backend: string): string | null {
    if (!safeStorage.isEncryptionAvailable()) {
      return 'OS encryption is unavailable. Install/configure a system keyring and restart the app.';
    }
    if (process.platform === 'linux' && backend === 'basic_text') {
      return 'Linux secret storage uses insecure basic_text. Install libsecret or KWallet and restart with a secure password store.';
    }
    return null;
  }

  private readEncryptedFile(): VaultFile {
    if (!existsSync(this.filePath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as VaultFile) : {};
    } catch {
      return {};
    }
  }

  private writeEncryptedFile(data: VaultFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data), { mode: 0o600 });
    // writeFile's mode does not replace permissions on a pre-existing file.
    chmodSync(this.filePath, 0o600);
  }
}
