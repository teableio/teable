import * as crypto from 'node:crypto';

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
  /**
   * Decrypt-only entry this deployment switches TO once its dedicated pair is removed (derived
   * from SECRET_KEY), accepted ahead of time so pods still on the dedicated pair open what the
   * switched pods issue. Not an old entry: what it sealed was not issued under an older key.
   */
  upcoming?: boolean;
  /**
   * Decrypt-only entry an operator pinned in the `_OLD` vars during a planned rotation (marked by
   * resolveCipherEntries). Unlike a public pair kept for what was issued before a switch, it goes
   * once the rotation is over, and what it sealed stops opening then.
   */
  pinned?: boolean;
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
    } catch {
      throw new Error('Encryption failed');
    }
  }

  decrypt(encryptedData: string): T {
    return this.decryptWithEntry(encryptedData).data;
  }

  /** Like decrypt, plus the entry that opened the ciphertext (which key sealed it). */
  decryptWithEntry(encryptedData: string): { data: T; entry: ICipherEntry } {
    for (const entry of this.entries) {
      try {
        return { data: this.decryptWith(entry, encryptedData), entry };
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
