import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveSecret } from './resolve-secret';
import { SECRET_SPECS } from './secret-specs';

// resolveSecret reads process.env directly — snapshot and restore the keys the
// tests mutate so the process-wide env stays intact for other suites.
const TOUCHED_KEYS = [
  'SECRET_KEY',
  'BACKEND_JWT_SECRET',
  'BACKEND_MAIL_ENCRYPTION_KEY',
  'BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY',
  'BACKEND_STORAGE_ENCRYPTION_KEY',
  'BACKEND_ENV_VARIABLE_SECRET',
] as const;

describe('resolveSecret', () => {
  let snapshot: Record<string, string | undefined>;

  beforeEach(() => {
    snapshot = Object.fromEntries(TOUCHED_KEYS.map((key) => [key, process.env[key]]));
  });

  afterEach(() => {
    for (const key of TOUCHED_KEYS) {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    }
  });

  it('prefers the dedicated env var', () => {
    process.env.BACKEND_MAIL_ENCRYPTION_KEY = 'dedicated-value';
    process.env.SECRET_KEY = 'root';
    expect(resolveSecret(SECRET_SPECS.mailEncryptionKey)).toBe('dedicated-value');
  });

  it('falls back to SECRET_KEY for umbrella specs before the legacy default', () => {
    delete process.env.BACKEND_JWT_SECRET;
    process.env.SECRET_KEY = 'root';
    expect(resolveSecret(SECRET_SPECS.jwtSecret)).toBe('root');
    // env-variable encryption follows the same umbrella shape
    delete process.env.BACKEND_ENV_VARIABLE_SECRET;
    expect(resolveSecret(SECRET_SPECS.envVariableSecret)).toBe('root');
  });

  it('keeps a spec without a derivePurpose on its legacy default', () => {
    const spec = { envKey: 'SOME_KEY', usedFor: 'x', legacyDefault: 'old' };
    expect(resolveSecret(spec, { SECRET_KEY: 'root' })).toBe('old');
  });

  it('derives the key/iv pairs from SECRET_KEY ahead of the legacy default', () => {
    // Their consumers decide whether the legacy literals stay decrypt-only
    // (resolveCipherEntries).
    const env = { SECRET_KEY: 'root' };
    const derived = [
      resolveSecret(SECRET_SPECS.mailEncryptionKey, env),
      resolveSecret(SECRET_SPECS.mailEncryptionIv, env),
      resolveSecret(SECRET_SPECS.accessTokenEncryptionKey, env),
      resolveSecret(SECRET_SPECS.accessTokenEncryptionIv, env),
      resolveSecret(SECRET_SPECS.storageEncryptionKey, env),
      resolveSecret(SECRET_SPECS.storageEncryptionIv, env),
    ];
    for (const value of derived) {
      expect(value).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(new Set(derived).size).toBe(6);
    expect(resolveSecret(SECRET_SPECS.mailEncryptionKey, { SECRET_KEY: 'other-root' })).not.toBe(
      derived[0]
    );
    expect(resolveSecret(SECRET_SPECS.mailEncryptionKey, {})).toBe(
      SECRET_SPECS.mailEncryptionKey.legacyDefault
    );
  });

  it('treats an empty-string env var as unset instead of blocking boot', () => {
    // Compose passthrough (`- VAR=${VAR}` with the host var unset) and blank
    // .env placeholder lines both yield '' — never a usable secret.
    process.env.BACKEND_MAIL_ENCRYPTION_KEY = '';
    delete process.env.SECRET_KEY;
    expect(resolveSecret(SECRET_SPECS.mailEncryptionKey)).toBe(
      SECRET_SPECS.mailEncryptionKey.legacyDefault
    );

    delete process.env.BACKEND_JWT_SECRET;
    process.env.SECRET_KEY = '';
    expect(resolveSecret(SECRET_SPECS.jwtSecret)).toBe(SECRET_SPECS.jwtSecret.legacyDefault);

    // An empty dedicated var does not shadow a configured umbrella either.
    process.env.BACKEND_JWT_SECRET = '';
    process.env.SECRET_KEY = 'root';
    expect(resolveSecret(SECRET_SPECS.jwtSecret)).toBe('root');
  });

  it('boots a zero-config environment on the legacy defaults', () => {
    delete process.env.BACKEND_MAIL_ENCRYPTION_KEY;
    delete process.env.BACKEND_JWT_SECRET;
    delete process.env.SECRET_KEY;
    expect(resolveSecret(SECRET_SPECS.mailEncryptionKey)).toBe(
      SECRET_SPECS.mailEncryptionKey.legacyDefault
    );
    expect(resolveSecret(SECRET_SPECS.jwtSecret)).toBe(SECRET_SPECS.jwtSecret.legacyDefault);
  });
});
