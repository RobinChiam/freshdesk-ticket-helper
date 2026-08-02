/**
 * OS credential vault wrapper around Electron safeStorage.
 * Secrets never go into SQLite, localStorage, or logs.
 *
 * Distinction:
 * - This TypeScript module (main/secrets/vault.ts) is tracked application source.
 * - The runtime encrypted file (typically userData/secrets.vault) holds ciphertext and
 *   must never be committed. Git ignores *.vault and /secrets/ (repo-local only).
 *
 * On Linux, refuses the insecure basic_text backend rather than storing plaintext.
 */
import { safeStorage } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type VaultStatus = {
  encryptionAvailable: boolean;
  storageBackend: string;
  freshdeskApiKeyPresent: boolean;
  wssDeviceTokenPresent: boolean;
  limitation: string | null;
};

type VaultFile = {
  freshdeskApiKey?: string;
  wssDeviceToken?: string;
};

type VaultSecretField = 'freshdeskApiKey' | 'wssDeviceToken';

export class SecretVault {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Inspect whether the OS can protect secrets on this machine. */
  getStatus(): VaultStatus {
    const backend = this.getBackend();
    const limitation = this.describeLimitation(backend);
    const data = this.readEncryptedFile();

    return {
      encryptionAvailable: limitation === null && safeStorage.isEncryptionAvailable(),
      storageBackend: backend,
      freshdeskApiKeyPresent: Boolean(data.freshdeskApiKey),
      wssDeviceTokenPresent: Boolean(data.wssDeviceToken),
      limitation,
    };
  }

  getFreshdeskApiKey(): string | null {
    return this.decryptField('freshdeskApiKey');
  }

  getWssDeviceToken(): string | null {
    return this.decryptField('wssDeviceToken');
  }

  setFreshdeskApiKey(value: string): void {
    this.assertCanStore();
    const data = this.readEncryptedFile();
    data.freshdeskApiKey = this.encrypt(value);
    this.writeEncryptedFile(data);
  }

  setWssDeviceToken(value: string): void {
    this.assertCanStore();
    const data = this.readEncryptedFile();
    data.wssDeviceToken = this.encrypt(value);
    this.writeEncryptedFile(data);
  }

  clearFreshdeskApiKey(): void {
    const data = this.readEncryptedFile();
    delete data.freshdeskApiKey;
    this.writeEncryptedFile(data);
  }

  clearWssDeviceToken(): void {
    const data = this.readEncryptedFile();
    delete data.wssDeviceToken;
    this.writeEncryptedFile(data);
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
    if (process.platform === 'linux') {
      try {
        return safeStorage.getSelectedStorageBackend();
      } catch {
        return 'unknown';
      }
    }
    return process.platform;
  }

  /**
   * Fail safely: Linux basic_text encrypts with a hardcoded key (effectively plaintext).
   * We refuse rather than silently storing unprotected secrets.
   */
  private describeLimitation(backend: string): string | null {
    if (!safeStorage.isEncryptionAvailable()) {
      return 'OS encryption is unavailable. Install/configure a system keyring and restart the app.';
    }
    if (process.platform === 'linux' && backend === 'basic_text') {
      return (
        'Linux secret storage fell back to basic_text (insecure). ' +
        'Refusing to store credentials. Install libsecret or KWallet, or launch with ' +
        '--password-store=gnome-libsecret (or kwallet5/kwallet6).'
      );
    }
    return null;
  }

  private encrypt(value: string): string {
    return safeStorage.encryptString(value).toString('base64');
  }

  private decryptField(key: VaultSecretField): string | null {
    const data = this.readEncryptedFile();
    const encrypted = data[key];
    if (!encrypted) {
      return null;
    }
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return null;
    }
  }

  private readEncryptedFile(): VaultFile {
    if (!existsSync(this.filePath)) {
      return {};
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as VaultFile;
      return parsed ?? {};
    } catch {
      return {};
    }
  }

  private writeEncryptedFile(data: VaultFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data), { mode: 0o600 });
  }
}
