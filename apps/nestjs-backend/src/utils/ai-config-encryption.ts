import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';
import { resolveSecret } from '../configs/secrets/resolve-secret';
import { SECRET_SPECS } from '../configs/secrets/secret-specs';

type IEnv = Record<string, string | undefined>;

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_INFO = 'teable:ai-config';

/**
 * Marks a ciphertext stored inside an AI config JSON blob. Legacy rows hold
 * the raw provider keys, so readers use the prefix to tell ciphertext from
 * plaintext — no real API key can start with it.
 */
export const AI_CONFIG_CIPHER_PREFIX = 'teable_enc_v1:';

export const isEncryptedAiConfigValue = (value: string): boolean =>
  value.startsWith(AI_CONFIG_CIPHER_PREFIX);

/**
 * AES-256-GCM value codec for secrets embedded in AI config JSON
 * (setting.aiConfig / integration.config). Mirrors the EE
 * EnvVariableEncryptor: keys[0] (HKDF of the resolved root) encrypts, every
 * key decrypts in order, and the `_OLD` root is a decrypt-only tail during a
 * planned rotation. The GCM auth tag makes "wrong key" a reliable signal.
 */
export class AiConfigValueCodec {
  /** keys[0] encrypts; every key participates in decryption, in order. */
  private readonly keys: Buffer[];
  /** True when the encrypting root is the publicly known zero-config default. */
  readonly usesPublicDefaultRoot: boolean;

  constructor(env: IEnv = process.env) {
    const primaryRoot = resolveSecret(SECRET_SPECS.aiConfigEncryptionSecret, env);
    const roots = [...new Set([primaryRoot, env.BACKEND_AI_CONFIG_ENCRYPTION_SECRET_OLD])].filter(
      (root): root is string => Boolean(root)
    );
    this.keys = roots.map((root) =>
      Buffer.from(hkdfSync('sha256', root, '', HKDF_INFO, KEY_BYTES))
    );
    this.usesPublicDefaultRoot =
      primaryRoot === SECRET_SPECS.aiConfigEncryptionSecret.legacyDefault;
  }

  /** Idempotent: an already-prefixed value is returned unchanged. */
  encryptValue(plaintext: string): string {
    if (isEncryptedAiConfigValue(plaintext)) {
      return plaintext;
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.keys[0], iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return AI_CONFIG_CIPHER_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
  }

  /** Plaintext passes through; an undecryptable ciphertext throws. */
  decryptValueStrict(value: string): string {
    if (!isEncryptedAiConfigValue(value)) {
      return value;
    }
    for (const key of this.keys) {
      try {
        return this.decryptWith(key, value);
      } catch {
        // Auth tag mismatch — not this key, try the next one.
      }
    }
    throw new Error('AI config secret decryption failed');
  }

  /** Whether the value already sits under the current primary key. */
  isCurrentValue(value: string): boolean {
    if (!isEncryptedAiConfigValue(value)) {
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
    const buf = Buffer.from(value.slice(AI_CONFIG_CIPHER_PREFIX.length), 'base64');
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const enc = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}

let defaultCodec: AiConfigValueCodec | undefined;

/** Process-wide codec over process.env (env never changes at runtime). */
export const getAiConfigValueCodec = (): AiConfigValueCodec => {
  defaultCodec ??= new AiConfigValueCodec();
  return defaultCodec;
};

type ISecretMapper = (value: string) => string;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mapField = (obj: Record<string, unknown>, key: string, fn: ISecretMapper) => {
  const value = obj[key];
  if (typeof value === 'string' && value !== '') {
    obj[key] = fn(value);
  }
  return obj;
};

/**
 * Apply `fn` to every secret slot of an AI config object (instance
 * setting.aiConfig or space integration.config — the space shape embeds the
 * instance one). Shape-tolerant and pure: unknown/partial shapes pass
 * through untouched and the input object is never mutated.
 *
 * Secret slots: llmProviders[].apiKey, aiGatewayApiKey, aiGatewayApiKeys[],
 * concurrencyGroups[].keys[].apiKey,
 * vertexByokCredential.googleCredentials.privateKey,
 * realtimeTranscription.apiKey.
 *
 * Deliberately NOT covered: the `appConfig` sub-object the space integration
 * shape adds (vercelToken, appAuth client secrets / SMTP credentials) — those
 * stay plaintext everywhere they are stored today (setting.appConfig
 * included) and belong to a separate hardening pass, not the AI-key scope.
 */
export const mapAiConfigSecrets = <T>(config: T, fn: ISecretMapper): T => {
  if (!isRecord(config)) {
    return config;
  }
  const next: Record<string, unknown> = { ...config };

  if (Array.isArray(next.llmProviders)) {
    next.llmProviders = next.llmProviders.map((provider) =>
      isRecord(provider) ? mapField({ ...provider }, 'apiKey', fn) : provider
    );
  }
  mapField(next, 'aiGatewayApiKey', fn);
  if (Array.isArray(next.aiGatewayApiKeys)) {
    next.aiGatewayApiKeys = next.aiGatewayApiKeys.map((key) =>
      typeof key === 'string' && key !== '' ? fn(key) : key
    );
  }
  if (Array.isArray(next.concurrencyGroups)) {
    next.concurrencyGroups = next.concurrencyGroups.map((group) => {
      if (!isRecord(group) || !Array.isArray(group.keys)) {
        return group;
      }
      return {
        ...group,
        keys: group.keys.map((entry) =>
          isRecord(entry) ? mapField({ ...entry }, 'apiKey', fn) : entry
        ),
      };
    });
  }
  if (isRecord(next.vertexByokCredential)) {
    const credential = { ...next.vertexByokCredential };
    if (isRecord(credential.googleCredentials)) {
      credential.googleCredentials = mapField(
        { ...credential.googleCredentials },
        'privateKey',
        fn
      );
    }
    next.vertexByokCredential = credential;
  }
  if (isRecord(next.realtimeTranscription)) {
    next.realtimeTranscription = mapField({ ...next.realtimeTranscription }, 'apiKey', fn);
  }

  return next as T;
};

/** Every secret value currently present in the config, for convergence checks. */
export const collectAiConfigSecrets = (config: unknown): string[] => {
  const collected: string[] = [];
  mapAiConfigSecrets(config, (value) => {
    collected.push(value);
    return value;
  });
  return collected;
};

const logger = new Logger('AiConfigEncryption');

/**
 * Encrypt every secret slot for storage. Values already carrying the cipher
 * prefix are kept as-is, so a read-modify-write over mixed content never
 * double-encrypts. Encryption is lazy (write-time only): stored plaintext is
 * untouched until the next write, so upgrading alone changes nothing — but a
 * reader that predates the cipher prefix must never share the DB with these
 * writes (old replica mid-rolling-deploy, a rolled-back build, the other
 * environment of a shared DB) or it hands ciphertext to the LLM provider.
 */
export const encryptAiConfigSecrets = <T>(config: T): T => {
  const codec = getAiConfigValueCodec();
  return mapAiConfigSecrets(config, (value) => codec.encryptValue(value));
};

/**
 * Decrypt every secret slot after a DB read. Legacy plaintext passes
 * through; a ciphertext no configured key opens is logged (with the caller's
 * row label so the operator can locate it) and returned verbatim so one bad
 * value never takes the whole settings read down (the provider call using it
 * fails visibly instead).
 */
export const decryptAiConfigSecrets = <T>(config: T, source = 'unknown'): T => {
  const codec = getAiConfigValueCodec();
  return mapAiConfigSecrets(config, (value) => {
    try {
      return codec.decryptValueStrict(value);
    } catch {
      logger.error(
        `Failed to decrypt an AI config secret in ${source} — check BACKEND_AI_CONFIG_ENCRYPTION_SECRET(_OLD)`
      );
      return value;
    }
  });
};
