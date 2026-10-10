import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { ICipherEntry } from '../../../utils/encryptor';
import type { IRespHeaders } from './types';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const NONCE_BYTES = 8;
const HKDF_INFO = 'teable:attachment-read-token';

export interface ILocalReadTokenParams {
  /** epoch seconds; `<= 0` never expires (object-meta urls rely on it) */
  expiresDate: number;
  respHeaders?: IRespHeaders;
}

export interface ILocalReadTokenPayload extends ILocalReadTokenParams {
  /** `bucket/path` of the one object this token may read */
  path: string;
  /** random per-token salt so two tokens for the same object never share bytes */
  nonce: string;
}

/**
 * Codec for the `token` query of local read urls. The generic Encryptor is
 * unauthenticated CBC under a static IV: its tokens were deterministic and
 * malleable, and carried no object claim, so any token opened any private
 * path. GCM seals the whole payload (object path included) under an auth tag
 * with a fresh IV per token. Keys derive from the same storage encryption
 * entries so one rotation covers both: entries[0] mints, every entry verifies
 * (the pinned `_OLD` pair is a decrypt-only tail).
 */
export class LocalReadTokenCodec {
  private readonly keys: Buffer[];

  constructor(entries: ICipherEntry[]) {
    if (entries.length === 0) {
      throw new Error('LocalReadTokenCodec requires at least one cipher entry');
    }
    this.keys = entries.map(({ key, iv }) =>
      Buffer.from(hkdfSync('sha256', key, iv, HKDF_INFO, KEY_BYTES))
    );
  }

  encode(payload: Omit<ILocalReadTokenPayload, 'nonce'>): string {
    const plaintext = JSON.stringify({
      ...payload,
      nonce: randomBytes(NONCE_BYTES).toString('base64url'),
    } satisfies ILocalReadTokenPayload);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.keys[0], iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
  }

  /** Throws for a token no configured key seals or whose claims are malformed. */
  decode(token: string): ILocalReadTokenPayload {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length <= IV_BYTES + TAG_BYTES) {
      throw new Error('Read token too short');
    }
    for (const key of this.keys) {
      let plaintext: string;
      try {
        plaintext = this.decryptWith(key, buf);
      } catch {
        // Auth tag mismatch — not this key, try the next one.
        continue;
      }
      return this.parsePayload(plaintext);
    }
    throw new Error('Read token verification failed');
  }

  private decryptWith(key: Buffer, buf: Buffer): string {
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const enc = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }

  private parsePayload(plaintext: string): ILocalReadTokenPayload {
    const payload = JSON.parse(plaintext) as Partial<ILocalReadTokenPayload>;
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof payload.path !== 'string' ||
      !payload.path ||
      typeof payload.expiresDate !== 'number'
    ) {
      throw new Error('Read token claims are malformed');
    }
    return payload as ILocalReadTokenPayload;
  }
}
