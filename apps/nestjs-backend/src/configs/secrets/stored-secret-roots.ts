import type { ISecretSpec } from './secret-specs';
import { SECRET_SPECS } from './secret-specs';

type IEnv = Record<string, string | undefined>;

export interface ISecretRoots {
  /** The root that encrypts or signs. */
  primary: string;
  /** Roots that only decrypt or verify what an earlier configuration wrote. */
  decryptOnly: string[];
}

export interface IStoredSecretPurpose {
  /** The dedicated var the purpose had before the stored credential root. */
  spec: ISecretSpec;
  /** The decrypt-only var that goes with that dedicated var. */
  oldEnvKey: string;
}

const STORED_ROOT = SECRET_SPECS.storedCredentialEncryptionSecret;
const STORED_ROOT_OLD_ENV_KEY = `${STORED_ROOT.envKey}_OLD`;

/**
 * What every purpose resolves to with nothing set: the stored credential root has no default
 * of its own, so it is the publicly known one SECRET_KEY falls back to, in this one place.
 */
export const PUBLIC_DEFAULT_STORED_ROOT: string = SECRET_SPECS.secretKey.legacyDefault;

/**
 * What is encrypted in the database, by purpose. Each keeps the key material of its own HKDF
 * info (or HMAC message), so sharing a root never makes one purpose's key open another's
 * values; what they share is where the root comes from.
 */
export const STORED_SECRET_PURPOSES = {
  thirdPartyCredential: {
    spec: SECRET_SPECS.thirdPartyCredentialEncryptionSecret,
    oldEnvKey: 'BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET_OLD',
  },
  aiConfig: {
    spec: SECRET_SPECS.aiConfigEncryptionSecret,
    oldEnvKey: 'BACKEND_AI_CONFIG_ENCRYPTION_SECRET_OLD',
  },
  envVariable: {
    spec: SECRET_SPECS.envVariableSecret,
    oldEnvKey: 'BACKEND_ENV_VARIABLE_SECRET_OLD',
  },
  welcomeReward: {
    spec: SECRET_SPECS.welcomeRewardSecret,
    oldEnvKey: 'BACKEND_WELCOME_REWARD_SECRET_OLD',
  },
  // The authenticated BYODB URL format; the legacy key/iv format is not rooted here.
  dataDbUrl: {
    spec: SECRET_SPECS.dataDbUrlEncryptionSecret,
    oldEnvKey: 'BACKEND_DATA_DB_URL_ENCRYPTION_SECRET_OLD',
  },
} as const satisfies Record<string, IStoredSecretPurpose>;

/**
 * The roots of one stored-secret purpose.
 *
 * The root that writes is the first of these that is set: the purpose's superseded dedicated
 * var, the stored credential root, SECRET_KEY; with none of them, the public default. An
 * upgrade therefore changes nothing: the stored credential root only takes over a purpose
 * whose dedicated var is unset.
 *
 * Roots that only read:
 * - the ones later in that order that are also set. They are what the purpose resolved to
 *   before the writing root was introduced, so setting the stored credential root on a
 *   deployment that ran on SECRET_KEY keeps what SECRET_KEY wrote readable with no extra var;
 * - the purpose's own `_OLD` var and the stored credential root's `_OLD` var. The latter
 *   reads for every purpose, also while the root itself is unset: wherever several processes
 *   share a database (replicas mid-rollout, two environments on one database), every reader
 *   gets a new root that way first, and only then does anyone write under it.
 *
 * The public default never reads on its own: what was written under it needs an `_OLD` var,
 * as before. An empty var counts as unset.
 */
export const resolveStoredSecretRoots = (
  purpose: IStoredSecretPurpose,
  env: IEnv = process.env
): ISecretRoots => {
  const chain = [purpose.spec.envKey, STORED_ROOT.envKey, SECRET_SPECS.secretKey.envKey]
    .map((key) => env[key])
    .filter((value): value is string => Boolean(value));
  const primary = chain[0] ?? PUBLIC_DEFAULT_STORED_ROOT;
  const decryptOnly = [
    ...chain.slice(1),
    env[purpose.oldEnvKey],
    env[STORED_ROOT_OLD_ENV_KEY],
  ].filter((value): value is string => Boolean(value) && value !== primary);
  return { primary, decryptOnly: [...new Set(decryptOnly)] };
};

/** Whether the root is the publicly known one a deployment with nothing set runs on. */
export const isPublicDefaultStoredRoot = (root: string): boolean =>
  root === PUBLIC_DEFAULT_STORED_ROOT;
