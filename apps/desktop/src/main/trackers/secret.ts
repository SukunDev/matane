/** The part of Electron's `safeStorage` the app uses (so tests can pass a fake). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
}

/**
 * Stores secrets as text: encrypted with the system keyring (`enc:` + base64) when there is one,
 * else as they are (`plain:`), which the UI says out loud. The same convention as the proxy password.
 */
export class SecretBox {
  constructor(private readonly storage: SafeStorageLike) {}

  seal(text: string): string {
    return this.storage.isEncryptionAvailable()
      ? `enc:${this.storage.encryptString(text).toString('base64')}`
      : `plain:${text}`;
  }

  /** The secret, or null when it cannot be read (a different keyring, a damaged value). */
  open(sealed: string | null): string | null {
    if (sealed === null) return null;
    if (sealed.startsWith('plain:')) return sealed.slice(6);
    if (!sealed.startsWith('enc:') || !this.storage.isEncryptionAvailable()) return null;
    try {
      return this.storage.decryptString(Buffer.from(sealed.slice(4), 'base64'));
    } catch {
      return null;
    }
  }

  isEncrypted(sealed: string | null): boolean | null {
    return sealed === null ? null : sealed.startsWith('enc:');
  }
}
