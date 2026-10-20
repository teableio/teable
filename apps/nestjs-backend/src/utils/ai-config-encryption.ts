import { Logger } from '@nestjs/common';
import { SECRET_SPECS } from '../configs/secrets/secret-specs';
import type { ISecretMapper } from './secret-value-codec';
import { SecretValueCodec } from './secret-value-codec';

type IEnv = Record<string, string | undefined>;

/**
 * Value codec for secrets embedded in AI config JSON (setting.aiConfig /
 * integration.config), rooted at BACKEND_AI_CONFIG_ENCRYPTION_SECRET.
 */
export class AiConfigValueCodec extends SecretValueCodec {
  constructor(env: IEnv = process.env) {
    super(
      {
        spec: SECRET_SPECS.aiConfigEncryptionSecret,
        oldEnvKey: 'BACKEND_AI_CONFIG_ENCRYPTION_SECRET_OLD',
        hkdfInfo: 'teable:ai-config',
        label: 'AI config secret',
      },
      env
    );
  }
}

let defaultCodec: AiConfigValueCodec | undefined;

/** Process-wide codec over process.env (env never changes at runtime). */
export const getAiConfigValueCodec = (): AiConfigValueCodec => {
  defaultCodec ??= new AiConfigValueCodec();
  return defaultCodec;
};

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
 * shape adds (vercelToken, appAuth client secrets / SMTP credentials). It is
 * encrypted by the third-party credential codec instead, like setting.appConfig —
 * see features/space/ai-integration-secrets.ts.
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
 * through; a ciphertext no configured key opens is logged and returned
 * verbatim so one bad value never takes the whole settings read down (the
 * provider call using it fails visibly instead). `logLabel` only names the row
 * in that log line so the operator can locate it — it plays no part in
 * decryption.
 */
export const decryptAiConfigSecrets = <T>(config: T, logLabel = 'unknown'): T => {
  const codec = getAiConfigValueCodec();
  return mapAiConfigSecrets(config, (value) => {
    try {
      return codec.decryptValueStrict(value);
    } catch {
      logger.error(
        `Failed to decrypt an AI config secret in ${logLabel} — check BACKEND_AI_CONFIG_ENCRYPTION_SECRET(_OLD)`
      );
      return value;
    }
  });
};
