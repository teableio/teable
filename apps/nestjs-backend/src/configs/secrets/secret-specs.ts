/**
 * Single source of truth for every server secret.
 *
 * Each secret resolves in layers (resolve-secret.ts): its dedicated env var,
 * then fallback env vars, then a value derived from the instance-wide
 * SECRET_KEY (specs with a derivePurpose), then the legacy source-code
 * default. Development and tests set NO secrets — they run on the same
 * fallbacks a zero-config instance uses (so the boot warning shows on every
 * dev boot, by design). enforceSecretsPolicy() warns loudly (but does not
 * block boot) when required env vars are missing, printing the pin
 * instructions declared here; only half a key/iv pair refuses to boot.
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
 * Authoring constraint: a missing secret never blocks boot, so
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
   * Derive from SECRET_KEY under this purpose when the dedicated var is unset,
   * ahead of legacyDefault, so an instance that sets only SECRET_KEY stops
   * running on the public literal. Only the key/iv pairs read through
   * resolveCipherEntries carry one; their consumer decides whether the legacy
   * pair, which an unset pair used to encrypt under, stays decrypt-only.
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

/** For specs whose only consumer is an EE / cloud feature: do not nag community boots. */
const isEeOrCloudEdition = (env: Record<string, string | undefined>) => {
  const edition = env.NEXT_BUILD_ENV_EDITION?.toUpperCase();
  return edition === 'EE' || edition === 'CLOUD';
};

export const SECRET_SPECS = {
  secretKey: {
    envKey: 'SECRET_KEY',
    // Besides the umbrella specs (fallbackEnvKeys) it seeds the derived key/iv
    // pairs (derivePurpose) — describe exactly what reads it.
    usedFor:
      'JWT/session fallback, BYODB URL key derivation, personal access token key derivation, mail unsubscribe-link key derivation, local storage read-token key derivation, EE env-variable encryption, AI-config key encryption, third-party credential encryption, invitation-code HMAC, welcome-reward inbox HMAC, plugin secret fallback',
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
    requiredWhen: isEeOrCloudEdition,
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
  // Same resolution shape as aiConfigEncryptionSecret; the HKDF info string
  // (teable:third-party-credential) keeps it apart from the AI-config key when
  // both fall back to SECRET_KEY.
  thirdPartyCredentialEncryptionSecret: {
    envKey: 'BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET',
    fallbackEnvKeys: ['SECRET_KEY'],
    usedFor:
      'encrypting third-party credentials stored for customers: OAuth tokens, IM bot credentials, SSO client secrets, SMTP passwords, app-builder secrets, automation webhook / mail secrets (HKDF root)',
    legacyDefault: 'defaultSecretKey',
    // Community also stores such credentials (instance settings, space AI
    // integrations), so once encrypt-on-write is on, an unset root means
    // encrypting them under the public default.
    requiredWhen: (env) =>
      isEeOrCloudEdition(env) || env.BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED === 'true',
  },
  // Only the unsubscribe-link tokens of EE mail (automation / notification
  // emails) use this pair; the community backend never reads it. With
  // SECRET_KEY set and the pair unset, new links use the derived pair and
  // mail.config keeps the legacy literals decrypt-only, so links already sent
  // keep working.
  mailEncryptionKey: {
    envKey: 'BACKEND_MAIL_ENCRYPTION_KEY',
    derivePurpose: 'mail-key',
    usedFor: 'encrypting email unsubscribe-link tokens',
    legacyDefault: 'ie21hOKjlXUiGDx1',
    requiredWhen: isEeOrCloudEdition,
  },
  mailEncryptionIv: {
    envKey: 'BACKEND_MAIL_ENCRYPTION_IV',
    derivePurpose: 'mail-iv',
    usedFor: 'encrypting email unsubscribe-link tokens',
    legacyDefault: 'i0vKGXBWkzyAoGf1',
    requiredWhen: isEeOrCloudEdition,
  },
  // The pair is only read by the local storage adapter (it seals attachment
  // read tokens); s3/minio/aliyun hand out presigned URLs instead. Same
  // default-to-local criterion as storage.config's provider field, and the
  // provider is fixed at boot — switching to 'local' later surfaces the pin
  // instructions at that restart.
  // With SECRET_KEY set and the pair unset, tokens are sealed under the
  // derived pair and storage.ts does not keep the legacy pair: a token only
  // claims a path, so a public pair left decrypt-only would keep minting read
  // links for any known path. Nothing is stored under the pair; links issued
  // before stop opening, and cached preview urls re-mint because the cache
  // fingerprint follows the key (getPreviewUrlConfigSig).
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
  // The pair only wraps each token's random sign, which validation compares
  // with the stored one, so the key alone cannot forge a token. With
  // SECRET_KEY set and the pair unset, new tokens use the derived pair and
  // auth.config keeps the legacy literals decrypt-only, so tokens already
  // issued (including never-expiring ones) keep working.
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
  // fallbackEnvKeys only tell the policy which vars keep the effective value
  // off the public literals; nothing resolves these specs via resolveSecret.
  dataDbUrlEncryptionKey: {
    envKey: 'BACKEND_DATA_DB_URL_ENCRYPTION_KEY',
    fallbackEnvKeys: ['BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY', 'SECRET_KEY'],
    usedFor: 'encrypting BYODB database URLs',
    pinInstruction:
      "previous effective value: your BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY if it was set, otherwise compute `node -e \"console.log(require('crypto').createHash('sha256').update(process.env.SECRET_KEY ?? 'teable-data-db-url-secret').digest('hex').slice(0,16))\"`. New deployments: `openssl rand -hex 8`.",
  },
  dataDbUrlEncryptionIv: {
    envKey: 'BACKEND_DATA_DB_URL_ENCRYPTION_IV',
    fallbackEnvKeys: ['BACKEND_ACCESS_TOKEN_ENCRYPTION_IV', 'SECRET_KEY'],
    usedFor: 'encrypting BYODB database URLs',
    pinInstruction:
      "previous effective value: your BACKEND_ACCESS_TOKEN_ENCRYPTION_IV if it was set; with SECRET_KEY set, compute `node -e \"console.log(require('crypto').createHash('sha256').update(process.env.SECRET_KEY).digest('hex').slice(0,16))\"` (key and iv share one derivation input — a historical quirk); with neither, the same command with 'teable-data-db-url-secret-iv' in place of process.env.SECRET_KEY. New deployments: `openssl rand -hex 8`.",
  },
  // HKDF root of the authenticated BYODB URL format (AES-256-GCM, see
  // data-db-url-secret.ts). It resolves like the other roots, but only the
  // dedicated var switches new writes to that format: the fallbacks serve
  // decryption alone, so every replica, and every environment sharing the
  // database, can read the format before any of them writes it. Unset, the
  // legacy pair above keeps writing, hence in scope only once it is set.
  dataDbUrlEncryptionSecret: {
    envKey: 'BACKEND_DATA_DB_URL_ENCRYPTION_SECRET',
    fallbackEnvKeys: ['SECRET_KEY'],
    usedFor: 'encrypting BYODB database URLs in the authenticated format (HKDF root)',
    legacyDefault: 'defaultSecretKey',
    requiredWhen: (env) => Boolean(env.BACKEND_DATA_DB_URL_ENCRYPTION_SECRET),
  },
  // Read straight from env by the EE automation script runner; the sandbox
  // service falls back to the same public value, so the pair keeps working.
  sandboxJwtSecret: {
    envKey: 'SANDBOX_JWT_SECRET',
    usedFor:
      'signing automation script sandbox execution tokens (set the same value on the sandbox service)',
    legacyDefault: 'p3CiEjfiAaa8B6pfVww33hMhm4Vv7aP0fqf3XWTL5X8=',
    requiredWhen: isEeOrCloudEdition,
  },
} as const satisfies Record<string, ISecretSpec>;

/** Every spec, for iteration by the guard. */
export const ALL_SECRET_SPECS: readonly ISecretSpec[] = Object.values(SECRET_SPECS);
