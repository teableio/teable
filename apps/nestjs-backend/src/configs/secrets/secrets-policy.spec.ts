import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { resolveSecret } from './resolve-secret';
import { ALL_SECRET_SPECS, SECRET_SPECS } from './secret-specs';
import {
  buildHalfConfiguredPairsMessage,
  buildMissingSecretsMessage,
  buildPublicDefaultsWarning,
  enforceSecretsPolicy,
  findHalfConfiguredPairs,
  findInsecureSecrets,
  findMissingSecrets,
  findPublicDefaultSecrets,
  isSecretAdminToolsEnabled,
} from './secrets-policy';

const fullEnv = {
  SECRET_KEY: 'strong-secret',
  BACKEND_JWT_SECRET: 'jwt-secret',
  BACKEND_SESSION_SECRET: 'session-secret',
  BACKEND_AI_CONFIG_ENCRYPTION_SECRET: 'ai-config-secret',
  BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET: 'third-party-credential-secret',
  BACKEND_MAIL_ENCRYPTION_KEY: 'k'.repeat(16),
  BACKEND_MAIL_ENCRYPTION_IV: 'v'.repeat(16),
  BACKEND_STORAGE_ENCRYPTION_KEY: 'k'.repeat(16),
  BACKEND_STORAGE_ENCRYPTION_IV: 'v'.repeat(16),
  BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'k'.repeat(16),
  BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'v'.repeat(16),
  BACKEND_DATA_DB_URL_ENCRYPTION_KEY: 'k'.repeat(16),
  BACKEND_DATA_DB_URL_ENCRYPTION_IV: 'v'.repeat(16),
  SANDBOX_JWT_SECRET: 'sandbox-jwt-secret',
};

describe('secrets guard', () => {
  it('accepts a fully configured environment', () => {
    expect(findMissingSecrets(ALL_SECRET_SPECS, fullEnv)).toEqual([]);
  });

  it('reports every secret missing on an empty environment, with pin teaching', () => {
    const missing = findMissingSecrets(ALL_SECRET_SPECS, {});
    // EE/cloud-only secrets (requiredWhen) are not nagged about on an empty
    // community env; everything else is required.
    const eeOnly = [
      'BACKEND_ENV_VARIABLE_SECRET',
      'BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET',
      'BACKEND_MAIL_ENCRYPTION_KEY',
      'BACKEND_MAIL_ENCRYPTION_IV',
      'SANDBOX_JWT_SECRET',
    ];
    expect(missing).toHaveLength(ALL_SECRET_SPECS.length - eeOnly.length);
    for (const envKey of eeOnly) {
      expect(missing.map((s) => s.envKey)).not.toContain(envKey);
    }
    expect(
      findMissingSecrets(ALL_SECRET_SPECS, { NEXT_BUILD_ENV_EDITION: 'EE' }).map((s) => s.envKey)
    ).toEqual(expect.arrayContaining(eeOnly));

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

  it('accepts SECRET_KEY for jwt, session and what derives from it', () => {
    const missing = findMissingSecrets(ALL_SECRET_SPECS, { SECRET_KEY: 'strong-secret' });
    const keys = missing.map((s) => s.envKey);
    expect(keys).not.toContain('BACKEND_JWT_SECRET');
    expect(keys).not.toContain('BACKEND_SESSION_SECRET');
    expect(keys).not.toContain('SECRET_KEY');
    // BYODB URLs have always been encrypted under sha256(SECRET_KEY) when no
    // dedicated or access-token pair is set — not a public value.
    expect(keys).not.toContain('BACKEND_DATA_DB_URL_ENCRYPTION_KEY');
    expect(keys).not.toContain('BACKEND_DATA_DB_URL_ENCRYPTION_IV');
    // Access tokens and local read tokens: new ones use the SECRET_KEY-derived pair.
    expect(keys).not.toContain('BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY');
    expect(keys).not.toContain('BACKEND_STORAGE_ENCRYPTION_KEY');
    expect(keys).not.toContain('BACKEND_STORAGE_ENCRYPTION_IV');
  });

  it('requires the storage encryption pair only for the local storage provider', () => {
    const {
      BACKEND_STORAGE_ENCRYPTION_KEY: _key,
      BACKEND_STORAGE_ENCRYPTION_IV: _iv,
      SECRET_KEY: _root,
      ...withoutStoragePair
    } = fullEnv;
    const missing = (env: Record<string, string>) =>
      findMissingSecrets(ALL_SECRET_SPECS, env).map((s) => s.envKey);

    // Unset provider defaults to local (same criterion as storage.config) —
    // the pair stays required.
    expect(missing(withoutStoragePair)).toEqual([
      'SECRET_KEY',
      'BACKEND_STORAGE_ENCRYPTION_KEY',
      'BACKEND_STORAGE_ENCRYPTION_IV',
    ]);
    // SECRET_KEY covers it: the pair derives from it.
    expect(missing({ ...withoutStoragePair, SECRET_KEY: 'strong-secret' })).toEqual([]);

    // Cloud providers never read the pair (presigned URLs) — the boot check
    // must not demand dead config.
    for (const provider of ['s3', 'minio', 'aliyun']) {
      expect(missing({ ...withoutStoragePair, BACKEND_STORAGE_PROVIDER: provider })).toEqual([
        'SECRET_KEY',
      ]);
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
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: SECRET_SPECS.accessTokenEncryptionKey.legacyDefault,
    };
    const flagged = findPublicDefaultSecrets(ALL_SECRET_SPECS, pinnedEnv);
    expect(flagged.map((s) => s.envKey).sort()).toEqual([
      'BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY',
      'BACKEND_JWT_SECRET',
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

  it('keeps the secret admin tools off unless SECRET_ADMIN_TOOLS_ENABLED is "true"', () => {
    expect(isSecretAdminToolsEnabled({})).toBe(false);
    expect(isSecretAdminToolsEnabled({ SECRET_ADMIN_TOOLS_ENABLED: 'false' })).toBe(false);
    expect(isSecretAdminToolsEnabled({ SECRET_ADMIN_TOOLS_ENABLED: '1' })).toBe(false);
    expect(isSecretAdminToolsEnabled({ SECRET_ADMIN_TOOLS_ENABLED: 'true' })).toBe(true);
  });

  describe('findInsecureSecrets', () => {
    const eeEnv = { ...fullEnv, NEXT_BUILD_ENV_EDITION: 'EE' };
    const keys = (env: Record<string, string>) =>
      findInsecureSecrets(env).map((issue) => issue.envKey);

    it('reports nothing on a fully configured environment of either edition', () => {
      expect(findInsecureSecrets(fullEnv)).toEqual([]);
      expect(findInsecureSecrets(eeEnv)).toEqual([]);
    });

    it('scopes the check to what the edition reads', () => {
      // On an empty environment SECRET_KEY stands in for everything it covers;
      // the sandbox JWT does not follow it.
      expect(keys({})).toEqual(['SECRET_KEY']);
      for (const edition of ['EE', 'CLOUD']) {
        expect(keys({ NEXT_BUILD_ENV_EDITION: edition })).toEqual([
          'SECRET_KEY',
          'SANDBOX_JWT_SECRET',
        ]);
      }

      // community never reads the env-variable root
      const pinnedEnvRoot = {
        ...fullEnv,
        BACKEND_ENV_VARIABLE_SECRET: SECRET_SPECS.envVariableSecret.legacyDefault,
      };
      expect(keys(pinnedEnvRoot)).toEqual([]);
      expect(keys({ ...pinnedEnvRoot, NEXT_BUILD_ENV_EDITION: 'EE' })).toEqual([
        'BACKEND_ENV_VARIABLE_SECRET',
      ]);
    });

    it('asks community for the third-party credential root only once encryption is on', () => {
      const pinnedRoot = {
        ...fullEnv,
        BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET:
          SECRET_SPECS.thirdPartyCredentialEncryptionSecret.legacyDefault,
      };
      expect(findInsecureSecrets(pinnedRoot)).toEqual([]);
      expect(
        findInsecureSecrets({
          ...pinnedRoot,
          BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED: 'true',
        })
      ).toEqual([
        { envKey: 'BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET', reason: 'publicDefault' },
      ]);
    });

    it('ignores a public default pinned on a secret the deployment never reads', () => {
      const pinnedStorage = {
        ...fullEnv,
        BACKEND_STORAGE_ENCRYPTION_KEY: SECRET_SPECS.storageEncryptionKey.legacyDefault,
      };
      expect(findInsecureSecrets(pinnedStorage)).toEqual([
        { envKey: 'BACKEND_STORAGE_ENCRYPTION_KEY', reason: 'publicDefault' },
      ]);
      expect(findInsecureSecrets({ ...pinnedStorage, BACKEND_STORAGE_PROVIDER: 's3' })).toEqual([]);

      // community never sends EE mail, so its unsubscribe-link pair is not checked
      const pinnedMail = {
        ...fullEnv,
        BACKEND_MAIL_ENCRYPTION_KEY: SECRET_SPECS.mailEncryptionKey.legacyDefault,
      };
      expect(findInsecureSecrets(pinnedMail)).toEqual([]);
      expect(findInsecureSecrets({ ...pinnedMail, NEXT_BUILD_ENV_EDITION: 'EE' })).toEqual([
        { envKey: 'BACKEND_MAIL_ENCRYPTION_KEY', reason: 'publicDefault' },
      ]);
    });

    it('counts SECRET_KEY for the BYODB pair and the pairs derived from it', () => {
      const {
        BACKEND_DATA_DB_URL_ENCRYPTION_KEY: _dataDbKey,
        BACKEND_DATA_DB_URL_ENCRYPTION_IV: _dataDbIv,
        BACKEND_MAIL_ENCRYPTION_KEY: _mailKey,
        BACKEND_MAIL_ENCRYPTION_IV: _mailIv,
        ...onlyRoot
      } = eeEnv;
      expect(keys(onlyRoot)).toEqual([]);

      // Without SECRET_KEY the mail pair and the env-variable root fall back to
      // public literals, but setting SECRET_KEY covers them, so only it is asked
      // for; the BYODB pair follows the access-token pair.
      const { SECRET_KEY: _root, ...withoutRoot } = onlyRoot;
      expect(keys(withoutRoot)).toEqual(['SECRET_KEY']);

      // SECRET_KEY alone also covers the access-token pair, and BYODB through it.
      const {
        BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: _patKey,
        BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: _patIv,
        ...rootWithoutPat
      } = onlyRoot;
      expect(keys(rootWithoutPat)).toEqual([]);
    });

    it('tells unset apart from pinned public defaults and never returns values', () => {
      const { SECRET_KEY: _root, ...withoutRoot } = eeEnv;
      const result = findInsecureSecrets({
        ...withoutRoot,
        BACKEND_SESSION_SECRET: SECRET_SPECS.sessionSecret.legacyDefault,
      });
      // a dedicated var pinned to its public default wins over SECRET_KEY, so it stays listed
      expect(result).toEqual([
        { envKey: 'SECRET_KEY', reason: 'missing' },
        { envKey: 'BACKEND_SESSION_SECRET', reason: 'publicDefault' },
      ]);
      expect(JSON.stringify(result)).not.toContain(SECRET_SPECS.sessionSecret.legacyDefault);
    });
  });

  describe('enforceSecretsPolicy', () => {
    it('never throws — logs the aggregated teaching message with copy-pastable blocks when secrets are missing', () => {
      const logged: string[] = [];
      expect(() => enforceSecretsPolicy({}, (message) => logged.push(message))).not.toThrow();
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('EXISTING deployment');
      // Both remediation paths are complete copy-pastable env lines.
      expect(logged[0]).toContain("BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY='ie21hOKjlXUiGDx9'");
      expect(logged[0]).toContain('BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 8)');
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

    it('refuses to boot on half a key/iv pair, naming the value to pin', () => {
      const {
        BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: _iv,
        SECRET_KEY: _root,
        ...halfPatWithoutRoot
      } = fullEnv;
      // Without SECRET_KEY the missing half has only ever run on its legacy literal.
      expect(() => enforceSecretsPolicy(halfPatWithoutRoot, () => undefined)).toThrow(
        /BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY is set, BACKEND_ACCESS_TOKEN_ENCRYPTION_IV is not[\s\S]*BACKEND_ACCESS_TOKEN_ENCRYPTION_IV='i0vKGXBWkzyAoGf4'/
      );
      // An empty string counts as unset, like everywhere else in the policy.
      expect(() =>
        enforceSecretsPolicy({ ...fullEnv, BACKEND_MAIL_ENCRYPTION_KEY: '' }, () => undefined)
      ).toThrow('BACKEND_MAIL_ENCRYPTION_IV is set, BACKEND_MAIL_ENCRYPTION_KEY is not');
      // BYODB: the previous value depends on the deployment, so it teaches how to compute it.
      const { BACKEND_DATA_DB_URL_ENCRYPTION_KEY: _key, ...halfByodb } = fullEnv;
      expect(() => enforceSecretsPolicy(halfByodb, () => undefined)).toThrow(
        '# BACKEND_DATA_DB_URL_ENCRYPTION_KEY — previous effective value'
      );
    });

    it('with SECRET_KEY set, names both values the missing half may have run on', () => {
      const { BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: _iv, ...halfPat } = fullEnv;
      const [pair] = findHalfConfiguredPairs(halfPat);
      const message = buildHalfConfiguredPairsMessage([pair], halfPat);
      const derived = resolveSecret(SECRET_SPECS.accessTokenEncryptionIv, {
        SECRET_KEY: halfPat.SECRET_KEY,
      });

      // The release that predates the derivation ran on the legacy literal...
      expect(message).toContain("use 'i0vKGXBWkzyAoGf4' instead");
      // ...later ones on the derived value, taught as a computation, never printed.
      expect(message).not.toContain(derived);
      const script = /node -e "(.+?)"`/.exec(message)?.[1];
      let computed: unknown;
      runInNewContext(script ?? '', {
        require: createRequire(import.meta.url),
        process: { env: { SECRET_KEY: halfPat.SECRET_KEY } },
        console: { log: (value: unknown) => (computed = value) },
      });
      expect(computed).toBe(derived);
    });

    it('checks every key/iv pair and accepts both halves set or both unset', () => {
      const { SECRET_KEY: _root, ...env } = fullEnv;
      expect(findHalfConfiguredPairs(fullEnv)).toEqual([]);
      expect(findHalfConfiguredPairs({})).toEqual([]);
      expect(
        findHalfConfiguredPairs({
          ...env,
          BACKEND_MAIL_ENCRYPTION_KEY: undefined,
          BACKEND_STORAGE_ENCRYPTION_IV: undefined,
        }).map(({ unset }) => unset.envKey)
      ).toEqual(['BACKEND_MAIL_ENCRYPTION_KEY', 'BACKEND_STORAGE_ENCRYPTION_IV']);
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
