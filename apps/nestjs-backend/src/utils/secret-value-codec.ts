import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { resolveSecret } from '../configs/secrets/resolve-secret';
import type { ISecretSpec } from '../configs/secrets/secret-specs';

type IEnv = Record<string, string | undefined>;

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Marks a ciphertext stored in place of a plaintext secret. Legacy rows hold
 * the raw value, so readers use the prefix to tell ciphertext from plaintext —
 * no real API key, OAuth token or app secret starts with it. Every codec
 * shares the prefix; which key opens a value follows from where it is stored.
 */
export const SECRET_CIPHER_PREFIX = 'teable_enc_v1:';

export const isEncryptedSecretValue = (value: string): boolean =>
  value.startsWith(SECRET_CIPHER_PREFIX);

/** Rewrites one secret string: encrypts, decrypts or re-encrypts it. */
export type ISecretMapper = (value: string) => string;

/** Applies an ISecretMapper to every secret slot of a parsed blob (mapAiConfigSecrets and friends). */
export type ISecretSlotMapper = <T>(config: T, fn: ISecretMapper) => T;

export interface ISecretValueCodecConfig {
  /** Resolves the encrypting HKDF root (dedicated var → fallbacks → legacy default). */
  spec: ISecretSpec;
  /** Decrypt-only root during a planned rotation. */
  oldEnvKey: string;
  /** HKDF info: keeps key material apart when two purposes resolve the same root. */
  hkdfInfo: string;
  /** Names the purpose in the decryption error. */
  label: string;
}

/**
 * AES-256-GCM value codec for secrets stored inside DB rows. Mirrors the EE
 * EnvVariableEncryptor: keys[0] (HKDF of the resolved root) encrypts, every
 * key decrypts in order, and the `_OLD` root is a decrypt-only tail during a
 * planned rotation. The GCM auth tag makes "wrong key" a reliable signal.
 *
 * Threat model: someone who can READ the database (read-only accounts,
 * backups, restore drills). No AAD binds a ciphertext to its row or column,
 * so someone who can WRITE the database could move one row's ciphertext into
 * another row and have it decrypt there — out of scope, they could equally
 * overwrite the value outright.
 */
export class SecretValueCodec {
  /** keys[0] encrypts; every key participates in decryption, in order. */
  private readonly keys: Buffer[];
  /** True when the encrypting root is the publicly known zero-config default. */
  readonly usesPublicDefaultRoot: boolean;
  private readonly label: string;

  constructor(config: ISecretValueCodecConfig, env: IEnv = process.env) {
    const primaryRoot = resolveSecret(config.spec, env);
    const roots = [...new Set([primaryRoot, env[config.oldEnvKey]])].filter(
      (root): root is string => Boolean(root)
    );
    this.keys = roots.map((root) =>
      Buffer.from(hkdfSync('sha256', root, '', config.hkdfInfo, KEY_BYTES))
    );
    this.usesPublicDefaultRoot = primaryRoot === config.spec.legacyDefault;
    this.label = config.label;
  }

  /** Idempotent: an already-prefixed value is returned unchanged. */
  encryptValue(plaintext: string): string {
    if (isEncryptedSecretValue(plaintext)) {
      return plaintext;
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.keys[0], iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return SECRET_CIPHER_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
  }

  /** Plaintext passes through; an undecryptable ciphertext throws. */
  decryptValueStrict(value: string): string {
    if (!isEncryptedSecretValue(value)) {
      return value;
    }
    for (const key of this.keys) {
      try {
        return this.decryptWith(key, value);
      } catch {
        // Auth tag mismatch — not this key, try the next one.
      }
    }
    throw new Error(`${this.label} decryption failed`);
  }

  /** Whether the value already sits under the current primary key. */
  isCurrentValue(value: string): boolean {
    if (!isEncryptedSecretValue(value)) {
      return false;
    }
    try {
      this.decryptWith(this.keys[0], value);
      return true;
    } catch {
      return false;
    }
  }

  private decryptWith(key: Buffer, value: string): string {
    const buf = Buffer.from(value.slice(SECRET_CIPHER_PREFIX.length), 'base64');
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const enc = buf.subarray(IV_BYTES + TAG_BYTES);
    // Pin the tag length: without it a truncated tag would be accepted.
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}
