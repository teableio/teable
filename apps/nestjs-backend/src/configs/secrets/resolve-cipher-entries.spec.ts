import { describe, expect, it } from 'vitest';
import { LocalReadTokenCodec } from '../../features/attachments/plugins/local-read-token';
import { Encryptor } from '../../utils/encryptor';
import { resolveCipherEntries } from './resolve-cipher-entries';
import { resolveSecret } from './resolve-secret';
import { SECRET_SPECS } from './secret-specs';

const ALGORITHM = 'aes-128-cbc';
const DEFAULT_KEY = SECRET_SPECS.accessTokenEncryptionKey.legacyDefault!;
const DEFAULT_IV = SECRET_SPECS.accessTokenEncryptionIv.legacyDefault!;

// Same options as auth.config.
const resolve = (env: Record<string, string | undefined>) =>
  resolveCipherEntries({
    algorithm: ALGORITHM,
    keySpec: SECRET_SPECS.accessTokenEncryptionKey,
    ivSpec: SECRET_SPECS.accessTokenEncryptionIv,
    keepLegacyForDecrypt: true,
    env,
  });

describe('resolveCipherEntries', () => {
  it('zero config → the public default is the single (encrypting) entry', () => {
    expect(resolve({})).toEqual([{ algorithm: ALGORITHM, key: DEFAULT_KEY, iv: DEFAULT_IV }]);
  });

  it('dedicated pair → single entry; the public default never enters the chain', () => {
    // Ciphertext forged under the publicly known literal must stay rejected
    // on a deployment that configured its own keys.
    const entries = resolve({
      SECRET_KEY: 'root',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'my-16-char-key00',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'my-16-char-iv000',
    });
    expect(entries).toEqual([
      { algorithm: ALGORITHM, key: 'my-16-char-key00', iv: 'my-16-char-iv000' },
    ]);
  });

  it('a pinned _OLD pair joins the decrypt tail', () => {
    const entries = resolve({
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'new-key-16-chars',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'new-iv-16-chars0',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY_OLD: 'old-key-16-chars',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV_OLD: 'old-iv-16-chars0',
    });
    expect(entries).toEqual([
      { algorithm: ALGORITHM, key: 'new-key-16-chars', iv: 'new-iv-16-chars0' },
      { algorithm: ALGORITHM, key: 'old-key-16-chars', iv: 'old-iv-16-chars0' },
    ]);
  });

  it('a key-only rotation pins the pair with the unchanged iv copied into _OLD', () => {
    const entries = resolve({
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'new-key-16-chars',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'shared-iv-16char',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY_OLD: 'old-key-16-chars',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV_OLD: 'shared-iv-16char',
    });
    expect(entries[1]).toEqual({
      algorithm: ALGORITHM,
      key: 'old-key-16-chars',
      iv: 'shared-iv-16char',
    });
  });

  it('half a pinned pair refuses to boot — guessing would strand old ciphertext', () => {
    expect(() =>
      resolve({
        BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'new-key-16-chars',
        BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'new-iv-16-chars0',
        BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY_OLD: 'old-key-16-chars',
      })
    ).toThrow('must be set together');
    expect(() =>
      resolve({
        BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'new-key-16-chars',
        BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'new-iv-16-chars0',
        BACKEND_ACCESS_TOKEN_ENCRYPTION_IV_OLD: 'old-iv-16-chars0',
      })
    ).toThrow('must be set together');
  });

  it('rotating away from the implicit default: pin it into _OLD', () => {
    // The upgrade path the boot warning teaches — a deployment that ran on
    // the built-in default pins it while switching to fresh values.
    const entries = resolve({
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'new-key-16-chars',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'new-iv-16-chars0',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY_OLD: DEFAULT_KEY,
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV_OLD: DEFAULT_IV,
    });
    expect(entries).toEqual([
      { algorithm: ALGORITHM, key: 'new-key-16-chars', iv: 'new-iv-16-chars0' },
      { algorithm: ALGORITHM, key: DEFAULT_KEY, iv: DEFAULT_IV },
    ]);
  });

  it('treats empty-string env vars as unset', () => {
    expect(
      resolve({
        BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: '',
        BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY_OLD: '',
        SECRET_KEY: '',
      })
    ).toEqual([{ algorithm: ALGORITHM, key: DEFAULT_KEY, iv: DEFAULT_IV }]);
  });
});

describe('resolveCipherEntries for a pair derived from SECRET_KEY', () => {
  const legacyPair = {
    algorithm: ALGORITHM,
    key: SECRET_SPECS.mailEncryptionKey.legacyDefault,
    iv: SECRET_SPECS.mailEncryptionIv.legacyDefault,
  };
  // Same options as mail.config.
  const resolveMail = (env: Record<string, string | undefined>) =>
    resolveCipherEntries({
      algorithm: ALGORITHM,
      keySpec: SECRET_SPECS.mailEncryptionKey,
      ivSpec: SECRET_SPECS.mailEncryptionIv,
      keepLegacyForDecrypt: true,
      env,
    });
  const encryptor = (entries: ReturnType<typeof resolveMail>) =>
    new Encryptor<{ id: string }>({ entries, encoding: 'base64' });

  it('encrypts under the derived pair and keeps the legacy pair decrypt-only', () => {
    const env = { SECRET_KEY: 'root' };
    const entries = resolveMail(env);
    expect(entries).toEqual([
      {
        algorithm: ALGORITHM,
        key: resolveSecret(SECRET_SPECS.mailEncryptionKey, env),
        iv: resolveSecret(SECRET_SPECS.mailEncryptionIv, env),
      },
      legacyPair,
    ]);

    // Links sent before the upgrade still open; new ones no longer use the
    // public pair.
    const sentBefore = encryptor([legacyPair]).encrypt({ id: 'old-link' });
    expect(encryptor(entries).decrypt(sentBefore)).toEqual({ id: 'old-link' });
    const sentAfter = encryptor(entries).encrypt({ id: 'new-link' });
    expect(() => encryptor([legacyPair]).decrypt(sentAfter)).toThrow('Decryption failed');
  });

  it('keeps access tokens issued before the upgrade valid, never-expiring ones included', () => {
    // A token only wraps its random sign; validation compares the sign with
    // the stored one, so the legacy pair left decrypt-only forges nothing.
    const env = { SECRET_KEY: 'root' };
    const entries = resolve(env);
    expect(entries).toEqual([
      {
        algorithm: ALGORITHM,
        key: resolveSecret(SECRET_SPECS.accessTokenEncryptionKey, env),
        iv: resolveSecret(SECRET_SPECS.accessTokenEncryptionIv, env),
      },
      { algorithm: ALGORITHM, key: DEFAULT_KEY, iv: DEFAULT_IV },
    ]);
    const signEncryptor = (cipherEntries: typeof entries) =>
      new Encryptor<{ sign: string }>({ entries: cipherEntries, encoding: 'base64' });
    const issuedBefore = signEncryptor([entries[1]]).encrypt({ sign: 'random-sign-16ch' });
    expect(signEncryptor(entries).decrypt(issuedBefore)).toEqual({ sign: 'random-sign-16ch' });
  });

  it('stays on the legacy pair alone without SECRET_KEY', () => {
    expect(resolveMail({})).toEqual([legacyPair]);
    expect(resolveMail({ SECRET_KEY: '' })).toEqual([legacyPair]);
  });

  it('drops the legacy pair once the pair is configured', () => {
    expect(
      resolveMail({
        SECRET_KEY: 'root',
        BACKEND_MAIL_ENCRYPTION_KEY: 'my-16-char-key00',
        BACKEND_MAIL_ENCRYPTION_IV: 'my-16-char-iv000',
      })
    ).toEqual([{ algorithm: ALGORITHM, key: 'my-16-char-key00', iv: 'my-16-char-iv000' }]);
  });
});

describe('resolveCipherEntries for the storage pair (no legacy decryption)', () => {
  const legacyPair = {
    algorithm: ALGORITHM,
    key: SECRET_SPECS.storageEncryptionKey.legacyDefault,
    iv: SECRET_SPECS.storageEncryptionIv.legacyDefault,
  };
  // Same options as storage.ts.
  const resolveStorage = (env: Record<string, string | undefined>) =>
    resolveCipherEntries({
      algorithm: ALGORITHM,
      keySpec: SECRET_SPECS.storageEncryptionKey,
      ivSpec: SECRET_SPECS.storageEncryptionIv,
      env,
    });

  it('seals under the derived pair alone, so read tokens forged with the public pair fail', () => {
    // A read token only claims a path: the public pair left decrypt-only would
    // keep minting never-expiring links to any known private file.
    const env = { SECRET_KEY: 'root' };
    const entries = resolveStorage(env);
    expect(entries).toEqual([
      {
        algorithm: ALGORITHM,
        key: resolveSecret(SECRET_SPECS.storageEncryptionKey, env),
        iv: resolveSecret(SECRET_SPECS.storageEncryptionIv, env),
      },
    ]);
    const forged = new LocalReadTokenCodec([legacyPair]).encode({
      path: 'private/table/known-path',
      expiresDate: -1,
    });
    expect(() => new LocalReadTokenCodec(entries).decode(forged)).toThrow();
  });

  it('stays on the legacy pair without SECRET_KEY', () => {
    expect(resolveStorage({})).toEqual([legacyPair]);
  });

  it('still honors a pinned _OLD pair', () => {
    const env = {
      SECRET_KEY: 'root',
      BACKEND_STORAGE_ENCRYPTION_KEY_OLD: 'old-key-16-chars',
      BACKEND_STORAGE_ENCRYPTION_IV_OLD: 'old-iv-16-chars0',
    };
    expect(resolveStorage(env)[1]).toEqual({
      algorithm: ALGORITHM,
      key: 'old-key-16-chars',
      iv: 'old-iv-16-chars0',
    });
  });
});
