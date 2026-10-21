import { Logger } from '@nestjs/common';
import { SECRET_SPECS } from '../configs/secrets/secret-specs';
import type { ISecretMapper } from './secret-value-codec';
import { SecretValueCodec } from './secret-value-codec';

type IEnv = Record<string, string | undefined>;

/**
 * Value codec for third-party credentials we hold on a customer's behalf:
 * OAuth tokens in user_integration.auth_config, Slack bot tokens in
 * im_oauth_installation, Feishu app credentials in space_im_config, the bot
 * secrets of the instance imConfig setting, SSO client secrets
 * (authentication.config), SMTP passwords (mail transport settings), the
 * app-builder appConfig secrets and the automation node secrets (legacy mail
 * passwords, webhook bearer secret / token). Rooted at
 * BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET (SECRET_KEY fallback), with
 * its own HKDF info so it never shares key material with the AI-config codec.
 */
export class ThirdPartyCredentialCodec extends SecretValueCodec {
  constructor(env: IEnv = process.env) {
    super(
      {
        spec: SECRET_SPECS.thirdPartyCredentialEncryptionSecret,
        oldEnvKey: 'BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET_OLD',
        hkdfInfo: 'teable:third-party-credential',
        label: 'Third-party credential',
      },
      env
    );
  }
}

let defaultCodec: ThirdPartyCredentialCodec | undefined;

/** Process-wide codec over process.env (env never changes at runtime). */
export const getThirdPartyCredentialCodec = (): ThirdPartyCredentialCodec => {
  defaultCodec ??= new ThirdPartyCredentialCodec();
  return defaultCodec;
};

/**
 * Encrypt-on-write switch: BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED=true.
 * Off by default because staging and prod share one database and staging
 * ships first: a ciphertext written there would reach a prod build that
 * predates this codec and be sent upstream as the token. Turn it on (in every
 * environment sharing the DB) only once each of them runs a decrypt-capable
 * build. Decryption is never gated — turning the switch off again leaves
 * stored ciphertext readable, it only stops new writes from encrypting.
 * Read per call, so a test can stub it.
 */
export const isThirdPartyCredentialEncryptionEnabled = (env: IEnv = process.env): boolean =>
  env.BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED === 'true';

/** Encrypt one credential for storage (idempotent); plaintext while the switch is off. */
export const encryptThirdPartyCredential = (value: string): string =>
  isThirdPartyCredentialEncryptionEnabled()
    ? getThirdPartyCredentialCodec().encryptValue(value)
    : value;

/** Optional columns: null / undefined / '' stay as they are. */
export const encryptOptionalThirdPartyCredential = <T extends string | null | undefined>(
  value: T
): T => (value ? (encryptThirdPartyCredential(value) as T) : value);

const logger = new Logger('ThirdPartyCredentialEncryption');

/**
 * Decrypt one stored credential after a DB read. Legacy plaintext passes
 * through; a ciphertext no configured key opens is logged and returned
 * verbatim, so the provider call using it fails visibly instead of the whole
 * read. `logLabel` (e.g. `user_integration:<id>`) only names the row in that
 * log line so the operator can locate it — it plays no part in decryption.
 */
export const decryptThirdPartyCredential = (value: string, logLabel = 'unknown'): string => {
  try {
    return getThirdPartyCredentialCodec().decryptValueStrict(value);
  } catch {
    logger.error(
      `Failed to decrypt a third-party credential in ${logLabel} — check BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET(_OLD)`
    );
    return value;
  }
};

/** Optional columns: null / undefined / '' stay as they are. */
export const decryptOptionalThirdPartyCredential = <T extends string | null | undefined>(
  value: T,
  logLabel?: string
): T => (value ? (decryptThirdPartyCredential(value, logLabel) as T) : value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The object keys leading to one secret string inside a JSON blob. */
export type ISecretPath = readonly string[];

const mapPath = (node: unknown, path: ISecretPath, fn: ISecretMapper): unknown => {
  if (!isRecord(node) || path.length === 0) return node;
  const [key, ...rest] = path;
  const child = node[key];
  if (rest.length === 0) {
    return typeof child === 'string' && child !== '' ? { ...node, [key]: fn(child) } : node;
  }
  const mapped = mapPath(child, rest, fn);
  return mapped === child ? node : { ...node, [key]: mapped };
};

/**
 * Apply `fn` to the string at each path; a missing, non-string or empty value
 * is skipped. Shape-tolerant and pure: objects along a rewritten path are
 * copied, the input object is never mutated.
 */
export const mapSecretPaths = <T>(config: T, paths: readonly ISecretPath[], fn: ISecretMapper): T =>
  paths.reduce<unknown>((node, path) => mapPath(node, path, fn), config) as T;
