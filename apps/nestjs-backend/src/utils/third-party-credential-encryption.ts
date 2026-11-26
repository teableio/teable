import { Logger } from '@nestjs/common';
import {
  resolveStoredSecretRoots,
  STORED_SECRET_PURPOSES,
} from '../configs/secrets/stored-secret-roots';
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
 * passwords, webhook bearer secret / token). Rooted at the stored credential
 * root (BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET, else SECRET_KEY; the
 * superseded BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET still takes its
 * place while set), with its own HKDF info so it never shares key material
 * with the AI-config codec.
 */
export class ThirdPartyCredentialCodec extends SecretValueCodec {
  constructor(env: IEnv = process.env) {
    super(
      {
        purpose: STORED_SECRET_PURPOSES.thirdPartyCredential,
        hkdfInfo: 'teable:third-party-credential',
        label: 'Third-party credential',
      },
      env
    );
  }
}

let defaultCodec: { roots: string; codec: ThirdPartyCredentialCodec } | undefined;

/**
 * Process-wide codec over process.env. The roots never change at runtime, so
 * a process builds it once; it is keyed on them only so that a test stubbing a
 * root gets the codec of that root.
 */
export const getThirdPartyCredentialCodec = (): ThirdPartyCredentialCodec => {
  const { primary, decryptOnly } = resolveStoredSecretRoots(
    STORED_SECRET_PURPOSES.thirdPartyCredential
  );
  const roots = [primary, ...decryptOnly].join('\n');
  if (defaultCodec?.roots !== roots) {
    defaultCodec = { roots, codec: new ThirdPartyCredentialCodec() };
  }
  return defaultCodec.codec;
};

/**
 * Encrypt one credential for storage (idempotent).
 *
 * An instance with no root set (the stored credential root, its superseded
 * dedicated var, SECRET_KEY) has only the publicly known default root, and there the value
 * is stored as it is: a ciphertext anyone can open protects nothing, and it
 * would stop opening the day the operator sets a private SECRET_KEY. The
 * re-encrypt page refuses that root as well (blockedPublicDefaultKey).
 * Decryption never depends on this, so rows written either way stay readable.
 */
export const encryptThirdPartyCredential = (value: string): string => {
  const codec = getThirdPartyCredentialCodec();
  return codec.usesPublicDefaultRoot ? value : codec.encryptValue(value);
};

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
      `Failed to decrypt a third-party credential in ${logLabel} — check BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET(_OLD) and BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET(_OLD)`
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
