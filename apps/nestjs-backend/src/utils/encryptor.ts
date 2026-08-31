import * as crypto from 'crypto';

/**
 * One symmetric cipher configuration. `algorithm` + `key` + `iv` always travel
 * as a group: rotating a key means introducing a whole new entry, never
 * swapping one field of an existing entry (old ciphertext was produced by the
 * exact triple).
 */
export interface ICipherEntry {
  algorithm: string;
  key: string | Buffer;
  iv: string | Buffer;
}

export interface IEncryptorOptions {
  /**
   * entries[0] encrypts; every entry participates in decryption, in order.
   * Tail entries are decrypt-only: previous keys pinned during a rotation and
   * the deployment's historical effective triple (see resolveCipherEntries).
   */
  entries: ICipherEntry[];
  encoding?: BufferEncoding;
}

export class Encryptor<T> {
  private readonly entries: ICipherEntry[];
  private readonly encoding: BufferEncoding;

  constructor(options: IEncryptorOptions) {
    const { entries, encoding = 'hex' } = options;
    if (entries.length === 0) {
      throw new Error('Encryptor requires at least one cipher entry');
    }
    this.entries = entries;
    this.encoding = encoding;
  }

  encrypt(data: T): string {
    try {
      const { algorithm, key, iv } = this.entries[0];
      const cipher = crypto.createCipheriv(algorithm, key, iv);
      const encrypted = cipher.update(JSON.stringify(data), 'utf-8', this.encoding);
      return encrypted + cipher.final(this.encoding);
    } catch (error) {
      throw new Error('Encryption failed');
    }
  }

  decrypt(encryptedData: string): T {
    for (const entry of this.entries) {
      try {
        return this.decryptWith(entry, encryptedData);
      } catch (error) {
        // Wrong entry for this ciphertext — try the next one. A wrong CBC key
        // almost always fails block padding; the rare false pass yields
        // garbage that JSON.parse below rejects, so falling through here is a
        // reliable "not this key" signal.
      }
    }
    throw new Error('Decryption failed');
  }

  private decryptWith(entry: ICipherEntry, encryptedData: string): T {
    const { algorithm, key, iv } = entry;
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    const decrypted = decipher.update(encryptedData, this.encoding, 'utf-8');
    return JSON.parse(decrypted + decipher.final('utf-8')) as T;
  }
}
