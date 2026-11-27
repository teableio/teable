import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildDataDbUrlCipher } from '../../features/space/data-db-url-secret';
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
  findWrongLengthCipherValues,
} from './secrets-policy';
import { resolveStoredSecretRoots, STORED_SECRET_PURPOSES } from './stored-secret-roots';

const fullEnv = {
  SECRET_KEY: 'strong-secret',
  BACKEND_JWT_SECRET: 'jwt-secret',
  BACKEND_SESSION_SECRET: 'session-secret',
  BACKEND_INVITATION_SECRET: 'invitation-secret',
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

  it('reports every secret missing on an empty environment, and offers none of the public values to set', () => {
    const missing = findMissingSecrets(ALL_SECRET_SPECS, {});
    // EE/cloud-only secrets (requiredWhen) are not nagged about on an empty
    // community env; everything else is required.
    const eeOnly = [
      'BACKEND_MAIL_ENCRYPTION_KEY',
      'BACKEND_MAIL_ENCRYPTION_IV',
      'SANDBOX_JWT_SECRET',
    ];
    // The stored credential root and what it superseded all end at SECRET_KEY, whose line
    // covers them: none is listed itself.
    const superseded = [
      'BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET',
      'BACKEND_ENV_VARIABLE_SECRET',
      'BACKEND_AI_CONFIG_ENCRYPTION_SECRET',
      'BACKEND_WELCOME_REWARD_SECRET',
      'BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET',
      'BACKEND_DATA_DB_URL_ENCRYPTION_SECRET',
    ];
    expect(missing).toHaveLength(ALL_SECRET_SPECS.length - eeOnly.length - superseded.length);
    for (const envKey of [...eeOnly, ...superseded]) {
      expect(missing.map((s) => s.envKey)).not.toContain(envKey);
    }
    expect(missing.map((s) => s.envKey)).toContain('SECRET_KEY');
    for (const edition of ['EE', 'CLOUD']) {
      const keys = findMissingSecrets(ALL_SECRET_SPECS, { NEXT_BUILD_ENV_EDITION: edition }).map(
        (s) => s.envKey
      );
      expect(keys).toEqual(expect.arrayContaining(eeOnly));
      for (const envKey of superseded) expect(keys).not.toContain(envKey);
    }

    const message = buildMissingSecretsMessage(missing);
    // What was stored under the public default stays readable through an _OLD var next to a
    // private SECRET_KEY; nothing teaches pinning a root to that default.
    expect(message).toContain("BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET_OLD='defaultSecretKey'");
    expect(message).not.toContain("BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET='defaultSecretKey'");
    expect(message).not.toContain("SECRET_KEY='defaultSecretKey'");
    for (const envKey of superseded) expect(message).not.toContain(`${envKey} (or`);
    for (const envKey of superseded.slice(1)) expect(message).not.toContain(envKey);
    expect(message).toContain('BACKEND_JWT_SECRET (or SECRET_KEY)');
    expect(message).toContain('SECRET_KEY: JWT/session fallback');
    // The built-in values are public and what follows SECRET_KEY needs no variable of its
    // own: no line sets a secret to the value it has been running on.
    for (const spec of missing) {
      expect(message).not.toMatch(new RegExp(`^\\s*${spec.envKey}='`, 'm'));
    }
    expect(message).not.toContain('533Cr3tK3yF0rH4sh1nGJ4W773k3n$');
    expect(message).not.toContain(
      'dafea6be69af1c1c3b8caf2b609342f6eb4540b554e19539f7643b75b480c932'
    );
    expect(message).not.toContain('ie21hOKjlXUiGDx9');
  });

  // The env lines the message tells a deployment that already has data to add.
  const keptReadable = (message: string) =>
    Object.fromEntries(
      message
        .split('\n')
        .map((line) => /^\s*([A-Z_]+_OLD)='(.+)'$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map(([, envKey, value]) => [envKey, value])
    );

  it('gives an existing deployment _OLD lines that keep what it stored readable', () => {
    const message = buildMissingSecretsMessage(findMissingSecrets(ALL_SECRET_SPECS, {}));
    const kept = keptReadable(message);
    expect(Object.keys(kept)).toEqual([
      'BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET_OLD',
      'BACKEND_INVITATION_SECRET_OLD',
      'BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD',
      'BACKEND_DATA_DB_URL_ENCRYPTION_IV_OLD',
    ]);
    // No signing secret is kept: its old value is public, so it is cut over.
    expect(message).not.toContain('BACKEND_JWT_SECRET_OLD=');
    expect(message).not.toContain('BACKEND_SESSION_SECRET_OLD=');

    // Followed to the letter, the lines open what the deployment wrote with nothing set.
    const adopted = { SECRET_KEY: 'a-private-root', ...kept };
    const url = 'postgresql://user:pass@db.example.com:5432/tenant';
    const storedWithNothingSet = buildDataDbUrlCipher({}).encrypt(url);
    expect(buildDataDbUrlCipher(adopted).decrypt(storedWithNothingSet)).toBe(url);
    expect(() =>
      buildDataDbUrlCipher({ SECRET_KEY: 'a-private-root' }).decrypt(storedWithNothingSet)
    ).toThrow();
    for (const purpose of Object.values(STORED_SECRET_PURPOSES)) {
      expect(resolveStoredSecretRoots(purpose, adopted)).toEqual({
        primary: 'a-private-root',
        decryptOnly: [resolveStoredSecretRoots(purpose, {}).primary],
      });
    }
  });

  it('says what changes at the switch, by what was unset', () => {
    const messageFor = (env: Record<string, string>) =>
      buildMissingSecretsMessage(findMissingSecrets(ALL_SECRET_SPECS, env), env);

    const nothingSet = messageFor({ NEXT_BUILD_ENV_EDITION: 'EE' });
    expect(nothingSet).toContain('everyone signs in again');
    expect(nothingSet).toContain('App Builder app credentials signed so far stop being accepted');
    expect(nothingSet).toContain(
      'personal access tokens and email unsubscribe links issued so far'
    );

    // A deployment that set its own signing secrets keeps its sessions and tokens.
    const ownSigningSecrets = messageFor({
      BACKEND_JWT_SECRET: 'jwt',
      BACKEND_SESSION_SECRET: 's',
    });
    expect(ownSigningSecrets).toContain('EXISTING deployment');
    expect(ownSigningSecrets).not.toContain('everyone signs in again');
    expect(ownSigningSecrets).not.toContain('stop being accepted');
    expect(ownSigningSecrets).toContain('personal access tokens issued so far keep working');

    // The mail pair keeps its old key whether or not the access-token pair has one of its own.
    const ownTokenPair = messageFor({
      NEXT_BUILD_ENV_EDITION: 'EE',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'k'.repeat(16),
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'v'.repeat(16),
    });
    expect(ownTokenPair).toContain('email unsubscribe links issued so far keep working');
    expect(ownTokenPair).not.toContain('personal access tokens');
  });

  it('gives no _OLD line for SECRET_KEY where a stored credential root of its own covers the data', () => {
    // A deployment rotating that root keeps its previous value in the very variable the line sets.
    const env = {
      NEXT_BUILD_ENV_EDITION: 'EE',
      BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET: 'a-private-stored-root',
      BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET_OLD: 'the-previous-stored-root',
    };
    const kept = keptReadable(
      buildMissingSecretsMessage(findMissingSecrets(ALL_SECRET_SPECS, env), env)
    );
    expect(Object.keys(kept)).toEqual([
      'BACKEND_INVITATION_SECRET_OLD',
      'BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD',
      'BACKEND_DATA_DB_URL_ENCRYPTION_IV_OLD',
    ]);
    // left as it is, the variable goes on reading what the previous stored root wrote
    for (const purpose of Object.values(STORED_SECRET_PURPOSES)) {
      const roots = resolveStoredSecretRoots(purpose, { ...env, SECRET_KEY: 'a-private-root' });
      expect(roots.primary).toBe('a-private-stored-root');
      expect(roots.decryptOnly).toContain('the-previous-stored-root');
    }

    const onDefault = { ...env, SECRET_KEY: SECRET_SPECS.secretKey.legacyDefault };
    const warning = buildPublicDefaultsWarning(
      findPublicDefaultSecrets(ALL_SECRET_SPECS, onDefault),
      onDefault
    );
    expect(Object.keys(keptReadable(warning))).toEqual([
      'BACKEND_INVITATION_SECRET_OLD',
      'BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD',
      'BACKEND_DATA_DB_URL_ENCRYPTION_IV_OLD',
    ]);
  });

  it('still says what changes at the switch where there is no _OLD line to add', () => {
    const env = {
      NEXT_BUILD_ENV_EDITION: 'EE',
      BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET: 'a-private-stored-root',
      BACKEND_INVITATION_SECRET: 'an-invitation-secret',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'k'.repeat(16),
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'v'.repeat(16),
    };
    const message = buildMissingSecretsMessage(findMissingSecrets(ALL_SECRET_SPECS, env), env);
    expect(keptReadable(message)).toEqual({});
    expect(message).toContain('EXISTING deployment');
    expect(message).toContain('everyone signs in again');
    expect(message).not.toContain('remove an _OLD line');
  });

  // The env lines the message offers a deployment to generate.
  const generated = (message: string) =>
    message
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[A-Z_]+=\$\(openssl rand /.test(line));

  it('tells a deployment to generate SECRET_KEY and what does not follow it, nothing else', () => {
    const missing = findMissingSecrets(ALL_SECRET_SPECS, { NEXT_BUILD_ENV_EDITION: 'EE' });
    const message = buildMissingSecretsMessage(missing);

    // Everything else falls back to SECRET_KEY or is derived from it; the sandbox secret is
    // the one that never follows it.
    expect(generated(message)).toEqual([
      'SECRET_KEY=$(openssl rand -base64 32)',
      'SANDBOX_JWT_SECRET=$(openssl rand -base64 32)',
    ]);
    expect(message).toContain('That is all a deployment sets.');
  });

  it('with SECRET_KEY set, asks only for what does not follow it', () => {
    const missing = findMissingSecrets(ALL_SECRET_SPECS, {
      NEXT_BUILD_ENV_EDITION: 'EE',
      SECRET_KEY: 'strong-secret',
    });
    const message = buildMissingSecretsMessage(missing);

    expect(generated(message)).toEqual(['SANDBOX_JWT_SECRET=$(openssl rand -base64 32)']);
    // nothing listed follows SECRET_KEY, so there is nothing to tell to leave unset
    expect(message).not.toContain('That is all a deployment sets.');
    // and nothing was stored under a built-in value that SECRET_KEY now covers
    expect(message).not.toContain('EXISTING deployment');
  });

  it('gives no line to generate a deprecated secret, whatever it follows', () => {
    const missing = findMissingSecrets(ALL_SECRET_SPECS, {});
    expect(missing.filter((s) => s.deprecated).map((s) => s.envKey)).toEqual([
      'BACKEND_DATA_DB_URL_ENCRYPTION_KEY',
      'BACKEND_DATA_DB_URL_ENCRYPTION_IV',
    ]);

    // one that nothing covers: it is listed, and with nothing to generate and nothing kept
    // readable the message has no block to copy
    const message = buildMissingSecretsMessage([
      {
        envKey: 'RETIRING_SECRET',
        usedFor: 'something on its way out',
        legacyDefault: 'old-value',
        deprecated: true,
      },
    ]);
    expect(message).toContain('  - RETIRING_SECRET: something on its way out');
    expect(message).not.toContain("RETIRING_SECRET='old-value'");
    expect(generated(message)).toEqual([]);
    expect(message).not.toContain('Set these');
    expect(message).not.toContain('EXISTING deployment');
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

  it('never asks for the stored credential root: SECRET_KEY covers what resolves through it', () => {
    const missing = (env: Record<string, string>) =>
      findMissingSecrets(ALL_SECRET_SPECS, env).map((s) => s.envKey);
    const {
      SECRET_KEY: _root,
      BACKEND_AI_CONFIG_ENCRYPTION_SECRET: _aiConfig,
      ...withoutAiConfigRoot
    } = fullEnv;
    // The AI config root is unset and nothing stands in for it: it runs on the public default
    // SECRET_KEY falls back to, and SECRET_KEY is the one variable asked for.
    expect(missing(withoutAiConfigRoot)).toEqual(['SECRET_KEY']);
    // Either root covers it.
    expect(
      missing({ ...withoutAiConfigRoot, BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET: 'stored' })
    ).toEqual(['SECRET_KEY']);
    expect(missing({ ...withoutAiConfigRoot, SECRET_KEY: 'strong-secret' })).toEqual([]);
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

  it('flags a stored credential root set to the default SECRET_KEY falls back to', () => {
    // The root has no former default of its own; the public value is the one its purposes
    // run on with nothing set.
    expect(SECRET_SPECS.storedCredentialEncryptionSecret).not.toHaveProperty('legacyDefault');
    const flagged = findPublicDefaultSecrets(ALL_SECRET_SPECS, {
      ...fullEnv,
      BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET: SECRET_SPECS.secretKey.legacyDefault,
    });
    expect(flagged.map((s) => s.envKey)).toEqual(['BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET']);
  });

  it('says how a SECRET_KEY left on its default is replaced without stranding what it stored', () => {
    const env = { ...fullEnv, SECRET_KEY: SECRET_SPECS.secretKey.legacyDefault };
    const rootOnDefault = findPublicDefaultSecrets(ALL_SECRET_SPECS, env);
    // Every other secret has a value of its own here: only what follows the root is kept.
    expect(keptReadable(buildPublicDefaultsWarning(rootOnDefault, env))).toEqual({
      BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET_OLD: 'defaultSecretKey',
    });
    const otherOnDefault = findPublicDefaultSecrets(ALL_SECRET_SPECS, {
      ...fullEnv,
      BACKEND_JWT_SECRET: SECRET_SPECS.jwtSecret.legacyDefault,
    });
    expect(buildPublicDefaultsWarning(otherOnDefault, fullEnv)).not.toContain('_OLD');
  });

  it('keeps the legacy BYODB pair of a deployment on the default SECRET_KEY readable', () => {
    // SECRET_KEY set to its public default and nothing else: the BYODB key and iv were both
    // derived from it, and the stored credential root's _OLD does not read them.
    const before = { SECRET_KEY: SECRET_SPECS.secretKey.legacyDefault };
    const warning = buildPublicDefaultsWarning(
      findPublicDefaultSecrets(ALL_SECRET_SPECS, before),
      before
    );
    const kept = keptReadable(warning);
    expect(Object.keys(kept)).toEqual([
      'BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET_OLD',
      'BACKEND_INVITATION_SECRET_OLD',
      'BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD',
      'BACKEND_DATA_DB_URL_ENCRYPTION_IV_OLD',
    ]);
    expect(kept.BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD).toBe(
      kept.BACKEND_DATA_DB_URL_ENCRYPTION_IV_OLD
    );
    // the invitation line is verified, not decrypted
    expect(warning).toContain('They only decrypt or verify');
    // what follows the old SECRET_KEY changes with it, as for a deployment that never set one
    expect(warning).toContain('everyone signs in again');
    expect(warning).toContain('App Builder app credentials signed so far stop being accepted');
    expect(warning).toContain('personal access tokens issued so far keep working');
    expect(warning).toContain('remove an _OLD line once nothing is left under it');

    // Followed to the letter, the lines open what the deployment wrote on the default.
    const url = 'postgresql://user:pass@db.example.com:5432/tenant';
    const stored = buildDataDbUrlCipher(before).encrypt(url);
    const adopted = { SECRET_KEY: 'a-private-root', ...kept };
    expect(buildDataDbUrlCipher(adopted).decrypt(stored)).toBe(url);
    // the stored credential root's _OLD alone leaves it unreadable
    expect(() =>
      buildDataDbUrlCipher({
        SECRET_KEY: 'a-private-root',
        BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET_OLD: 'defaultSecretKey',
      }).decrypt(stored)
    ).toThrow();
    for (const purpose of Object.values(STORED_SECRET_PURPOSES)) {
      expect(resolveStoredSecretRoots(purpose, adopted)).toEqual({
        primary: 'a-private-root',
        decryptOnly: [resolveStoredSecretRoots(purpose, before).primary],
      });
    }
  });

  it('offers no BYODB pair where the URLs never ran on the one derived from SECRET_KEY', () => {
    const onDefault = { SECRET_KEY: SECRET_SPECS.secretKey.legacyDefault };
    const pairs = [
      // a pair of its own
      {
        BACKEND_DATA_DB_URL_ENCRYPTION_KEY: 'k'.repeat(16),
        BACKEND_DATA_DB_URL_ENCRYPTION_IV: 'v'.repeat(16),
      },
      // the access-token pair, which the URLs fall back to before SECRET_KEY
      {
        BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'k'.repeat(16),
        BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'v'.repeat(16),
      },
    ];
    for (const pair of pairs) {
      const env = { ...onDefault, ...pair };
      const warning = buildPublicDefaultsWarning(
        findPublicDefaultSecrets(ALL_SECRET_SPECS, env),
        env
      );
      expect(warning).not.toContain('BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD');
      // and what the deployment stored still opens under a new root with nothing added
      const url = 'postgresql://user:pass@db.example.com:5432/tenant';
      const stored = buildDataDbUrlCipher(env).encrypt(url);
      expect(buildDataDbUrlCipher({ ...env, SECRET_KEY: 'a-private-root' }).decrypt(stored)).toBe(
        url
      );
    }
  });

  it('announces the coming startup refusal in production mode, where SECRET_KEY is the cause', () => {
    const notice = 'A LATER VERSION WILL REFUSE TO START while SECRET_KEY is unset';
    const production = { NODE_ENV: 'production' };
    const missingRoot = findMissingSecrets(ALL_SECRET_SPECS, {});
    expect(missingRoot.map((s) => s.envKey)).toContain('SECRET_KEY');
    const onDefault = findPublicDefaultSecrets(ALL_SECRET_SPECS, {
      ...fullEnv,
      SECRET_KEY: SECRET_SPECS.secretKey.legacyDefault,
    });
    expect(onDefault.map((s) => s.envKey)).toEqual(['SECRET_KEY']);
    expect(buildMissingSecretsMessage(missingRoot, production)).toContain(notice);
    expect(buildPublicDefaultsWarning(onDefault, production)).toContain(notice);

    // The refusal will only apply in production mode: development and tests, which run
    // without a SECRET_KEY, are not told.
    for (const env of [{}, { NODE_ENV: 'development' }, { NODE_ENV: 'test' }]) {
      expect(buildMissingSecretsMessage(missingRoot, env)).not.toContain(notice);
      expect(buildPublicDefaultsWarning(onDefault, env)).not.toContain(notice);
    }

    const otherDefault = findPublicDefaultSecrets(ALL_SECRET_SPECS, {
      ...fullEnv,
      BACKEND_JWT_SECRET: SECRET_SPECS.jwtSecret.legacyDefault,
    });
    expect(buildPublicDefaultsWarning(otherDefault, production)).not.toContain(notice);

    const { SANDBOX_JWT_SECRET: _sandbox, ...withoutSandbox } = fullEnv;
    const missingOther = findMissingSecrets(ALL_SECRET_SPECS, {
      ...withoutSandbox,
      NEXT_BUILD_ENV_EDITION: 'EE',
    });
    expect(missingOther.map((s) => s.envKey)).toEqual(['SANDBOX_JWT_SECRET']);
    expect(buildMissingSecretsMessage(missingOther, production)).not.toContain(notice);
  });

  it('carries the announcement in the boot warning of a production instance', () => {
    const logged: string[] = [];
    enforceSecretsPolicy({ NODE_ENV: 'production' }, (message) => logged.push(message));
    expect(logged.join('\n')).toContain('A LATER VERSION WILL REFUSE TO START');

    logged.length = 0;
    enforceSecretsPolicy({ NODE_ENV: 'development' }, (message) => logged.push(message));
    expect(logged.join('\n')).toContain('SECURITY WARNING: missing secret');
    expect(logged.join('\n')).not.toContain('A LATER VERSION WILL REFUSE TO START');
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

    it('asks community for the third-party credential root too', () => {
      const pinnedRoot = {
        ...fullEnv,
        BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET:
          SECRET_SPECS.thirdPartyCredentialEncryptionSecret.legacyDefault,
      };
      expect(findInsecureSecrets(pinnedRoot)).toEqual([
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

    it('checks the BYODB root whenever it is set, its public default included', () => {
      const byodbRoot = 'BACKEND_DATA_DB_URL_ENCRYPTION_SECRET';
      // unset, the purpose follows the roots that are set: nothing of its own to report
      expect(keys(fullEnv)).not.toContain(byodbRoot);
      expect(keys({})).not.toContain(byodbRoot);
      // On its public default it keeps the legacy format in use, whatever else is private:
      // the backend reads it, so it is reported instead of going out of scope.
      const publicRoot = SECRET_SPECS.dataDbUrlEncryptionSecret.legacyDefault;
      expect(findInsecureSecrets({ ...fullEnv, [byodbRoot]: publicRoot })).toEqual([
        { envKey: byodbRoot, reason: 'publicDefault' },
      ]);
      expect(findInsecureSecrets({ [byodbRoot]: publicRoot })).toEqual([
        { envKey: 'SECRET_KEY', reason: 'missing' },
        { envKey: byodbRoot, reason: 'publicDefault' },
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
      // What to set and what an existing deployment adds are complete copy-pastable env lines.
      expect(logged[0]).toContain('SECRET_KEY=$(openssl rand -base64 32)');
      expect(logged[0]).toContain(
        "BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET_OLD='defaultSecretKey'"
      );
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

    it('names access token and mail key/iv values of the wrong length, never the values', () => {
      const env = {
        ...fullEnv,
        BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'too-short',
        BACKEND_MAIL_ENCRYPTION_IV_OLD: 'x'.repeat(20),
        BACKEND_MAIL_ENCRYPTION_KEY_OLD: 'k'.repeat(16),
      };
      expect(findWrongLengthCipherValues(env)).toEqual([
        { envKey: 'BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY', bytes: 16 },
        { envKey: 'BACKEND_MAIL_ENCRYPTION_IV_OLD', bytes: 16 },
      ]);
      // a longer key for a cipher that takes one
      expect(
        findWrongLengthCipherValues({
          ...fullEnv,
          BACKEND_ACCESS_TOKEN_ENCRYPTION_ALGORITHM: 'aes-256-cbc',
          BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'k'.repeat(32),
        })
      ).toEqual([]);

      const logged: string[] = [];
      expect(() => enforceSecretsPolicy(env, (message) => logged.push(message))).not.toThrow();
      expect(logged.join('\n')).toContain(
        'BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY must be exactly 16 bytes'
      );
      expect(logged.join('\n')).not.toContain('too-short');
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
