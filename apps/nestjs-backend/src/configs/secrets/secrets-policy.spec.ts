import { describe, expect, it } from 'vitest';
import { ALL_SECRET_SPECS, SECRET_SPECS } from './secret-specs';
import {
  buildMissingSecretsMessage,
  buildPublicDefaultsWarning,
  enforceSecretsPolicy,
  findMissingSecrets,
  findPublicDefaultSecrets,
} from './secrets-policy';

const fullEnv = {
  SECRET_KEY: 'strong-secret',
  BACKEND_JWT_SECRET: 'jwt-secret',
  BACKEND_SESSION_SECRET: 'session-secret',
  BACKEND_AI_CONFIG_ENCRYPTION_SECRET: 'ai-config-secret',
  BACKEND_MAIL_ENCRYPTION_KEY: 'k'.repeat(16),
  BACKEND_MAIL_ENCRYPTION_IV: 'v'.repeat(16),
  BACKEND_STORAGE_ENCRYPTION_KEY: 'k'.repeat(16),
  BACKEND_STORAGE_ENCRYPTION_IV: 'v'.repeat(16),
  BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'k'.repeat(16),
  BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'v'.repeat(16),
  BACKEND_DATA_DB_URL_ENCRYPTION_KEY: 'k'.repeat(16),
  BACKEND_DATA_DB_URL_ENCRYPTION_IV: 'v'.repeat(16),
};

describe('secrets guard', () => {
  it('accepts a fully configured environment', () => {
    expect(findMissingSecrets(ALL_SECRET_SPECS, fullEnv)).toEqual([]);
  });

  it('reports every secret missing on an empty environment, with pin teaching', () => {
    const missing = findMissingSecrets(ALL_SECRET_SPECS, {});
    // envVariableSecret is EE/cloud-only (requiredWhen) — an empty community
    // env is not nagged about it, everything else is required.
    expect(missing).toHaveLength(ALL_SECRET_SPECS.length - 1);
    expect(missing.map((s) => s.envKey)).not.toContain('BACKEND_ENV_VARIABLE_SECRET');
    expect(
      findMissingSecrets(ALL_SECRET_SPECS, { NEXT_BUILD_ENV_EDITION: 'EE' }).map((s) => s.envKey)
    ).toContain('BACKEND_ENV_VARIABLE_SECRET');

    const message = buildMissingSecretsMessage(missing);
    expect(message).toContain('BACKEND_JWT_SECRET (or SECRET_KEY)');
    expect(message).toContain('533Cr3tK3yF0rH4sh1nGJ4W773k3n$');
    expect(message).toContain('dafea6be69af1c1c3b8caf2b609342f6eb4540b554e19539f7643b75b480c932');
    expect(message).toContain('ie21hOKjlXUiGDx9');
    expect(message).toContain('SECRET_KEY: JWT/session fallback');
  });

  it('teaches how to COMPUTE the data-db-url values instead of printing derived key material', () => {
    const missing = findMissingSecrets(ALL_SECRET_SPECS, {});
    const message = buildMissingSecretsMessage(missing);
    expect(message).toContain('BACKEND_DATA_DB_URL_ENCRYPTION_KEY');
    expect(message).toContain("createHash('sha256')");
  });

  it('accepts SECRET_KEY as an umbrella for jwt and session only', () => {
    const missing = findMissingSecrets(ALL_SECRET_SPECS, { SECRET_KEY: 'strong-secret' });
    const keys = missing.map((s) => s.envKey);
    expect(keys).not.toContain('BACKEND_JWT_SECRET');
    expect(keys).not.toContain('BACKEND_SESSION_SECRET');
    expect(keys).not.toContain('SECRET_KEY');
    // Encryption vars stay flagged: SECRET_KEY is no umbrella for them — a
    // deployment without dedicated vars runs on the legacy literal defaults
    // (resolving to a derived value instead would silently change the
    // effective keys of an existing deployment), so the warning must still
    // teach setting them.
    expect(keys).toContain('BACKEND_MAIL_ENCRYPTION_KEY');
    expect(keys).toContain('BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY');
    expect(keys).toContain('BACKEND_DATA_DB_URL_ENCRYPTION_KEY');
  });

  it('requires the storage encryption pair only for the local storage provider', () => {
    const {
      BACKEND_STORAGE_ENCRYPTION_KEY: _key,
      BACKEND_STORAGE_ENCRYPTION_IV: _iv,
      ...withoutStoragePair
    } = fullEnv;

    // Unset provider defaults to local (same criterion as storage.config) —
    // the pair stays required.
    expect(findMissingSecrets(ALL_SECRET_SPECS, withoutStoragePair).map((s) => s.envKey)).toEqual([
      'BACKEND_STORAGE_ENCRYPTION_KEY',
      'BACKEND_STORAGE_ENCRYPTION_IV',
    ]);

    // Cloud providers never read the pair (presigned URLs) — the boot check
    // must not demand dead config.
    for (const provider of ['s3', 'minio', 'aliyun']) {
      expect(
        findMissingSecrets(ALL_SECRET_SPECS, {
          ...withoutStoragePair,
          BACKEND_STORAGE_PROVIDER: provider,
        })
      ).toEqual([]);
    }
    expect(() =>
      enforceSecretsPolicy({ ...withoutStoragePair, BACKEND_STORAGE_PROVIDER: 's3' })
    ).not.toThrow();
  });

  it('still requires SECRET_KEY when every dedicated var is set', () => {
    const { SECRET_KEY: _omitted, ...withoutRoot } = fullEnv;
    const missing = findMissingSecrets(ALL_SECRET_SPECS, withoutRoot);
    expect(missing.map((s) => s.envKey)).toEqual(['SECRET_KEY']);
  });

  it('flags secrets pinned to their public former defaults, and only those', () => {
    const pinnedEnv = {
      ...fullEnv,
      BACKEND_JWT_SECRET: SECRET_SPECS.jwtSecret.legacyDefault,
      BACKEND_MAIL_ENCRYPTION_KEY: SECRET_SPECS.mailEncryptionKey.legacyDefault,
    };
    const flagged = findPublicDefaultSecrets(ALL_SECRET_SPECS, pinnedEnv);
    expect(flagged.map((s) => s.envKey).sort()).toEqual([
      'BACKEND_JWT_SECRET',
      'BACKEND_MAIL_ENCRYPTION_KEY',
    ]);

    const warning = buildPublicDefaultsWarning(flagged);
    expect(warning).toContain('PUBLICLY KNOWN');
    expect(warning).toContain('BACKEND_JWT_SECRET');
    // The warning names the vars but never re-prints the secret values.
    expect(warning).not.toContain(SECRET_SPECS.jwtSecret.legacyDefault as string);
  });

  it('does not flag freshly generated values', () => {
    expect(findPublicDefaultSecrets(ALL_SECRET_SPECS, fullEnv)).toEqual([]);
  });

  describe('enforceSecretsPolicy', () => {
    it('never throws — logs the aggregated teaching message with copy-pastable blocks when secrets are missing', () => {
      const logged: string[] = [];
      expect(() => enforceSecretsPolicy({}, (message) => logged.push(message))).not.toThrow();
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('EXISTING deployment');
      // Both remediation paths are complete copy-pastable env lines.
      expect(logged[0]).toContain("BACKEND_MAIL_ENCRYPTION_KEY='ie21hOKjlXUiGDx1'");
      expect(logged[0]).toContain('BACKEND_MAIL_ENCRYPTION_KEY=$(openssl rand -hex 8)');
      // The message must be explicit that boot continues on public defaults.
      expect(logged[0]).toContain('PUBLICLY KNOWN');
    });

    it('boots but logs a warning when running on public defaults', () => {
      const logged: string[] = [];
      enforceSecretsPolicy(
        { ...fullEnv, BACKEND_JWT_SECRET: SECRET_SPECS.jwtSecret.legacyDefault },
        (message) => logged.push(message)
      );
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('PUBLICLY KNOWN');
    });

    it('stays quiet on a fully configured environment', () => {
      const logged: string[] = [];
      enforceSecretsPolicy(fullEnv, (message) => logged.push(message));
      expect(logged).toEqual([]);
    });

    it('behaves identically in every environment (local IS production)', () => {
      const logged: string[] = [];
      enforceSecretsPolicy({ NODE_ENV: 'development' }, (message) => logged.push(message));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('EXISTING deployment');

      const quiet: string[] = [];
      enforceSecretsPolicy({ NODE_ENV: 'development', ...fullEnv }, (m) => quiet.push(m));
      expect(quiet).toEqual([]);
    });
  });
});
