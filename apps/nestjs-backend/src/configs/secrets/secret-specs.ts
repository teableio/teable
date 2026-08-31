/**
 * Single source of truth for every server secret.
 *
 * Each secret resolves in layers (resolve-secret.ts): its dedicated env var,
 * then fallback env vars, then the legacy source-code default, then a value
 * derived from the instance-wide SECRET_KEY. Development and tests set NO
 * secrets — they run on the same fallbacks a zero-config instance uses (so
 * the boot warning shows on every dev boot, by design). enforceSecretsPolicy()
 * warns loudly (but never blocks boot) when required env vars are missing,
 * printing the pin instructions declared here.
 *
 * `legacyDefault` is the PUBLIC value that used to be hardcoded in source (it
 * lives in git history, so printing it is harmless). It serves three purposes:
 * it is the last-resort fallback that lets a zero-config instance boot, the
 * boot warning teaches existing deployments to pin it, and the guard warns
 * loudly when an instance explicitly runs on it. Secrets whose previous
 * effective value was NOT a public constant use `pinInstruction` instead —
 * never print derived key material.
 */

/**
 * Authoring constraint: enforceSecretsPolicy promises boot NEVER blocks, so
 * every spec resolved through resolveSecret must yield a value with zero env
 * configured — give it a legacyDefault. derivePurpose alone is not enough:
 * without SECRET_KEY the derivation yields nothing and resolveSecret throws.
 */
export interface ISecretSpec {
  /** dedicated env var */
  envKey: string;
  /** additional env vars that satisfy the requirement (e.g. SECRET_KEY umbrella) */
  fallbackEnvKeys?: string[];
  /**
   * Derive from SECRET_KEY under this purpose when the dedicated var is unset.
   * Shadowed by legacyDefault (which resolves first) on every current spec —
   * the branch only fires for a future spec that has no legacy literal.
   */
  derivePurpose?: string;
  usedFor: string;
  /** public literal that used to be the source-code default */
  legacyDefault?: string;
  /** printed in the boot error when the previous value is not a public constant */
  pinInstruction?: string;
  /**
   * Required only while this predicate holds (default: always). For secrets
   * whose sole consumer is itself selected by boot-time env — demanding them
   * unconditionally would force dead config on deployments that never read
   * them and undermine the boot warning's credibility.
   */
  requiredWhen?: (env: Record<string, string | undefined>) => boolean;
}

export const SECRET_SPECS = {
  secretKey: {
    envKey: 'SECRET_KEY',
    // NOT an umbrella for the encryption keys: unset encryption vars resolve
    // to their legacy literals, not to SECRET_KEY derivations (see
    // resolve-secret.ts) — so describe only what actually reads it.
    usedFor:
      'JWT/session fallback, BYODB URL key derivation, EE env-variable encryption, AI-config key encryption, invitation-code HMAC, plugin secret fallback',
    // 'defaultSecretKey' was only ever the dev fallback for EE env-variable
    // encryption; deployments that relied on it must pin it to keep decrypting.
    legacyDefault: 'defaultSecretKey',
    pinInstruction:
      "generate one: `openssl rand -base64 32`. Existing deployments that stored EE app env-variables WITHOUT SECRET_KEY set must pin BACKEND_ENV_VARIABLE_SECRET='defaultSecretKey' to keep decrypting them (rotate via BACKEND_ENV_VARIABLE_SECRET_OLD afterwards).",
  },
  jwtSecret: {
    envKey: 'BACKEND_JWT_SECRET',
    fallbackEnvKeys: ['SECRET_KEY'],
    usedFor: 'signing auth / share / plugin JWTs',
    legacyDefault: '533Cr3tK3yF0rH4sh1nGJ4W773k3n$',
  },
  sessionSecret: {
    envKey: 'BACKEND_SESSION_SECRET',
    fallbackEnvKeys: ['SECRET_KEY'],
    usedFor: 'signing login session cookies',
    legacyDefault: 'dafea6be69af1c1c3b8caf2b609342f6eb4540b554e19539f7643b75b480c932',
  },
  // Same shape as jwtSecret: dedicated var, then the SECRET_KEY umbrella
  // (byte-identical to the pre-dedicated behavior), then the public dev
  // default. HKDF input, so any strong value works (`openssl rand -base64 32`).
  envVariableSecret: {
    envKey: 'BACKEND_ENV_VARIABLE_SECRET',
    fallbackEnvKeys: ['SECRET_KEY'],
    usedFor: 'encrypting EE app env variables (HKDF root)',
    legacyDefault: 'defaultSecretKey',
    // The consumer is an EE-only feature — do not nag community boots.
    requiredWhen: (env) => {
      const edition = env.NEXT_BUILD_ENV_EDITION?.toUpperCase();
      return edition === 'EE' || edition === 'CLOUD';
    },
  },
  // Same resolution shape as envVariableSecret (dedicated var → SECRET_KEY →
  // the public dev default); a distinct HKDF info string keeps its key
  // material separate even when the roots collide. HKDF input, so any strong
  // value works (`openssl rand -base64 32`).
  aiConfigEncryptionSecret: {
    envKey: 'BACKEND_AI_CONFIG_ENCRYPTION_SECRET',
    fallbackEnvKeys: ['SECRET_KEY'],
    usedFor: 'encrypting AI provider API keys stored in instance/space AI config (HKDF root)',
    legacyDefault: 'defaultSecretKey',
  },
  mailEncryptionKey: {
    envKey: 'BACKEND_MAIL_ENCRYPTION_KEY',
    derivePurpose: 'mail-key',
    usedFor: 'encrypting email unsubscribe-link tokens',
    legacyDefault: 'ie21hOKjlXUiGDx1',
  },
  mailEncryptionIv: {
    envKey: 'BACKEND_MAIL_ENCRYPTION_IV',
    derivePurpose: 'mail-iv',
    usedFor: 'encrypting email unsubscribe-link tokens',
    legacyDefault: 'i0vKGXBWkzyAoGf1',
  },
  // The pair is only read by the local storage adapter (it mints expiring
  // attachment-URL tokens); s3/minio/aliyun hand out presigned URLs instead.
  // Same default-to-local criterion as storage.config's provider field, and
  // the provider is fixed at boot — switching to 'local' later surfaces the
  // pin instructions at that restart.
  storageEncryptionKey: {
    envKey: 'BACKEND_STORAGE_ENCRYPTION_KEY',
    derivePurpose: 'storage-key',
    usedFor: 'encrypting attachment access tokens (local storage provider only)',
    legacyDefault: '73b00476e456323e',
    requiredWhen: (env) => (env.BACKEND_STORAGE_PROVIDER ?? 'local') === 'local',
  },
  storageEncryptionIv: {
    envKey: 'BACKEND_STORAGE_ENCRYPTION_IV',
    derivePurpose: 'storage-iv',
    usedFor: 'encrypting attachment access tokens (local storage provider only)',
    legacyDefault: '8c9183e4c175f63c',
    requiredWhen: (env) => (env.BACKEND_STORAGE_PROVIDER ?? 'local') === 'local',
  },
  accessTokenEncryptionKey: {
    envKey: 'BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY',
    derivePurpose: 'access-token-key',
    usedFor: 'encrypting personal access tokens',
    legacyDefault: 'ie21hOKjlXUiGDx9',
  },
  accessTokenEncryptionIv: {
    envKey: 'BACKEND_ACCESS_TOKEN_ENCRYPTION_IV',
    derivePurpose: 'access-token-iv',
    usedFor: 'encrypting personal access tokens',
    legacyDefault: 'i0vKGXBWkzyAoGf4',
  },
  // BYODB keys keep their historical resolution chain (dedicated var, then the
  // access-token key, then sha256(SECRET_KEY ?? a public literal), where key
  // == iv when SECRET_KEY is set) — see data-db-url-secret.ts. Their previous
  // effective value depends on the deployment's own env, so the boot warning
  // teaches how to compute it and never prints derived key material.
  dataDbUrlEncryptionKey: {
    envKey: 'BACKEND_DATA_DB_URL_ENCRYPTION_KEY',
    usedFor: 'encrypting BYODB database URLs',
    pinInstruction:
      "previous effective value: your BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY if it was set, otherwise compute `node -e \"console.log(require('crypto').createHash('sha256').update(process.env.SECRET_KEY ?? 'teable-data-db-url-secret').digest('hex').slice(0,16))\"`. New deployments: `openssl rand -hex 8`.",
  },
  dataDbUrlEncryptionIv: {
    envKey: 'BACKEND_DATA_DB_URL_ENCRYPTION_IV',
    usedFor: 'encrypting BYODB database URLs',
    pinInstruction:
      "previous effective value: your BACKEND_ACCESS_TOKEN_ENCRYPTION_IV if it was set; with SECRET_KEY set, compute `node -e \"console.log(require('crypto').createHash('sha256').update(process.env.SECRET_KEY).digest('hex').slice(0,16))\"` (key and iv share one derivation input — a historical quirk); with neither, the same command with 'teable-data-db-url-secret-iv' in place of process.env.SECRET_KEY. New deployments: `openssl rand -hex 8`.",
  },
} as const satisfies Record<string, ISecretSpec>;

/** Every spec, for iteration by the guard. */
export const ALL_SECRET_SPECS: readonly ISecretSpec[] = Object.values(SECRET_SPECS);
