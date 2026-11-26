import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SECRET_SPECS } from '../../configs/secrets/secret-specs';
import { Encryptor } from '../../utils/encryptor';
import { isEncryptedSecretValue, SECRET_CIPHER_PREFIX } from '../../utils/secret-value-codec';
import { buildDataDbUrlCipher, buildDataDbUrlCipherEntries } from './data-db-url-secret';

const ALGORITHM = 'aes-128-cbc';
const URL = 'postgresql://u:p@h:5432/db';
// sha256('teable-data-db-url-secret').slice(0, 16) / ...-iv — the zero-config
// legacy derivation.
const LITERAL_KEY = 'ed333d03ac334ea2';
const LITERAL_IV = '3c50b81e61cb7f52';
// Golden vectors generated with the pre-rotation implementation.
const LITERAL_CIPHER =
  '485e14f25be321b0221852961bdc4c05ba0cc2ae2821df02aada6d42987895f7f2b795a74adc210a4eb32e89ba0c2793';
// Encrypted under the SECRET_KEY='rootsecret' quirk (key == iv == sha256(root)).
const QUIRK_CIPHER =
  '1e90092fc40a2bb3feabb419904327fcf9def1937818d945e27b1463e9c47fec3ee940d3b39ab709cf22a5f56842bfeb';

const open = (env: Record<string, string | undefined>, cipher: string) =>
  new Encryptor<{ url: string }>({ entries: buildDataDbUrlCipherEntries(env) }).decrypt(cipher);

// A URL as it was stored under an explicit key and iv.
const storedUnder = (key: string, iv: string) =>
  new Encryptor<{ url: string }>({ entries: [{ algorithm: ALGORITHM, key, iv }] }).encrypt({
    url: URL,
  });

// What a deployment following the public env docs sets: an access-token pair, no pair for
// BYODB URLs. The legacy pair falls back to it, so its URLs are stored under this one.
const PAT_ENV = {
  BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'private-pat-key0',
  BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'private-pat-iv00',
};

describe('buildDataDbUrlCipherEntries', () => {
  it('zero config → single legacy-literal entry, decrypts pre-rotation ciphertext', () => {
    expect(buildDataDbUrlCipherEntries({})).toEqual([
      { algorithm: ALGORITHM, key: LITERAL_KEY, iv: LITERAL_IV },
    ]);
    expect(open({}, LITERAL_CIPHER)).toEqual({ url: URL });
  });

  it('SECRET_KEY deployment keeps the key==iv quirk as the writer (pre-rotation behavior)', () => {
    const entries = buildDataDbUrlCipherEntries({ SECRET_KEY: 'rootsecret' });
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe(entries[0].iv);
    expect(open({ SECRET_KEY: 'rootsecret' }, QUIRK_CIPHER)).toEqual({ url: URL });
  });

  it('access-token pair stays the writer when it is the only configured material', () => {
    // A deployment whose sole private material is a custom access-token pair
    // must never fall through to the publicly computable literal derivation.
    const entries = buildDataDbUrlCipherEntries({
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'private-pat-key0',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'private-pat-iv00',
    });
    expect(entries).toEqual([
      { algorithm: ALGORITHM, key: 'private-pat-key0', iv: 'private-pat-iv00' },
    ]);
  });

  it('dedicated pair rotation via _OLD', () => {
    const beforeEntries = buildDataDbUrlCipherEntries({
      BACKEND_DATA_DB_URL_ENCRYPTION_KEY: 'old-key-16-chars',
      BACKEND_DATA_DB_URL_ENCRYPTION_IV: 'old-iv-16-chars0',
    });
    const oldCipher = new Encryptor<{ url: string }>({ entries: beforeEntries }).encrypt({
      url: URL,
    });
    const after = {
      BACKEND_DATA_DB_URL_ENCRYPTION_KEY: 'new-key-16-chars',
      BACKEND_DATA_DB_URL_ENCRYPTION_IV: 'new-iv-16-chars0',
      BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD: 'old-key-16-chars',
      BACKEND_DATA_DB_URL_ENCRYPTION_IV_OLD: 'old-iv-16-chars0',
    };
    expect(open(after, oldCipher)).toEqual({ url: URL });
  });

  it('an iv-only dedicated rotation pins the pair with the unchanged key copied into _OLD', () => {
    const oldCipher = new Encryptor<{ url: string }>({
      entries: buildDataDbUrlCipherEntries({
        BACKEND_DATA_DB_URL_ENCRYPTION_KEY: 'shared-key-16chr',
        BACKEND_DATA_DB_URL_ENCRYPTION_IV: 'old-iv-16-chars0',
      }),
    }).encrypt({ url: URL });
    const after = {
      BACKEND_DATA_DB_URL_ENCRYPTION_KEY: 'shared-key-16chr',
      BACKEND_DATA_DB_URL_ENCRYPTION_IV: 'new-iv-16-chars0',
      BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD: 'shared-key-16chr',
      BACKEND_DATA_DB_URL_ENCRYPTION_IV_OLD: 'old-iv-16-chars0',
    };
    expect(open(after, oldCipher)).toEqual({ url: URL });
  });

  it('half a pinned dedicated pair refuses to boot', () => {
    expect(() =>
      buildDataDbUrlCipherEntries({
        BACKEND_DATA_DB_URL_ENCRYPTION_KEY: 'new-key-16-chars',
        BACKEND_DATA_DB_URL_ENCRYPTION_IV: 'new-iv-16-chars0',
        BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD: 'old-key-16-chars',
      })
    ).toThrow('must be set together');
  });

  it('a rotated PAT key without a coupled-era PAT iv opens via the primary-iv candidate', () => {
    // Coupled era: PAT key configured but no PAT iv — BYODB encrypted under
    // the literal-derived iv. The rotation pins the PAT pair (iv copied from
    // the PAT purpose's own effective value), and the tail's second
    // candidate (old key + this purpose's primary iv) opens the URL.
    const oldCipher = new Encryptor<{ url: string }>({
      entries: buildDataDbUrlCipherEntries({
        BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'old-pat-key00000',
      }),
    }).encrypt({ url: URL });
    const after = {
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'new-pat-key00000',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY_OLD: 'old-pat-key00000',
      // the PAT purpose's previous effective iv was its public literal
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV_OLD: 'i0vKGXBWkzyAoGf4',
    };
    expect(open(after, oldCipher)).toEqual({ url: URL });
  });

  it('a rotated access-token pair keeps coupled URLs readable via its _OLD tail', () => {
    const before = {
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'old-pat-key00000',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'old-pat-iv000000',
    };
    const oldCipher = new Encryptor<{ url: string }>({
      entries: buildDataDbUrlCipherEntries(before),
    }).encrypt({ url: URL });
    const after = {
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: 'new-pat-key00000',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: 'new-pat-iv000000',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY_OLD: 'old-pat-key00000',
      BACKEND_ACCESS_TOKEN_ENCRYPTION_IV_OLD: 'old-pat-iv000000',
    };
    expect(open(after, oldCipher)).toEqual({ url: URL });
  });
});

const ROOT_OLD = 'BACKEND_DATA_DB_URL_ENCRYPTION_SECRET_OLD';
const LEGACY_ENV = {
  BACKEND_DATA_DB_URL_ENCRYPTION_KEY: 'legacy-key-16chr',
  BACKEND_DATA_DB_URL_ENCRYPTION_IV: 'legacy-iv-16chr0',
};
const SWITCHED_ENV = { ...LEGACY_ENV, SECRET_KEY: 'instance-secret' };

describe('buildDataDbUrlCipher', () => {
  it('keeps writing the legacy format while SECRET_KEY is unset', () => {
    const cipher = buildDataDbUrlCipher(LEGACY_ENV);
    const stored = cipher.encrypt(URL);

    expect(cipher.authenticated).toBe(false);
    expect(isEncryptedSecretValue(stored)).toBe(false);
    expect(open(LEGACY_ENV, stored)).toEqual({ url: URL });
    expect(cipher.decrypt(stored)).toBe(URL);
    expect(cipher.isCurrent(stored)).toBe(true);
  });

  it('zero config still opens the pre-rotation ciphertext', () => {
    expect(buildDataDbUrlCipher({}).decrypt(LITERAL_CIPHER)).toBe(URL);
  });

  it('writes the authenticated format under a private SECRET_KEY, with a fresh nonce per write', () => {
    const cipher = buildDataDbUrlCipher(SWITCHED_ENV);
    const first = cipher.encrypt(URL);
    const second = cipher.encrypt(URL);

    expect(cipher.authenticated).toBe(true);
    expect(isEncryptedSecretValue(first)).toBe(true);
    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe(URL);
    expect(cipher.decrypt(second)).toBe(URL);
    expect(cipher.isCurrent(first)).toBe(true);
    expect(cipher.usesPublicKey).toBe(false);
  });

  it('refuses a value whose nonce, auth tag or ciphertext was altered', () => {
    const cipher = buildDataDbUrlCipher(SWITCHED_ENV);
    const raw = Buffer.from(cipher.encrypt(URL).slice(SECRET_CIPHER_PREFIX.length), 'base64');
    const flipped = (index: number) => {
      const copy = Buffer.from(raw);
      copy[index] ^= 1;
      return SECRET_CIPHER_PREFIX + copy.toString('base64');
    };

    // layout: 12-byte nonce, 16-byte tag, ciphertext
    for (const index of [0, 12, raw.length - 1]) {
      expect(() => cipher.decrypt(flipped(index))).toThrow('BYODB URL decryption failed');
    }
  });

  it('still opens legacy ciphertext after the switch, and reports it as not current', () => {
    const legacyStored = buildDataDbUrlCipher(LEGACY_ENV).encrypt(URL);
    const cipher = buildDataDbUrlCipher(SWITCHED_ENV);

    expect(cipher.decrypt(legacyStored)).toBe(URL);
    expect(cipher.isCurrent(legacyStored)).toBe(false);
  });

  it('still opens what the same SECRET_KEY wrote in the legacy format, reported as not current', () => {
    const env = { SECRET_KEY: 'instance-secret' };
    // what this deployment wrote before the format followed SECRET_KEY
    const legacyStored = new Encryptor<{ url: string }>({
      entries: buildDataDbUrlCipherEntries(env),
    }).encrypt({ url: URL });
    const cipher = buildDataDbUrlCipher(env);

    expect(isEncryptedSecretValue(legacyStored)).toBe(false);
    expect(cipher.decrypt(legacyStored)).toBe(URL);
    expect(cipher.isCurrent(legacyStored)).toBe(false);
  });

  it('keeps the legacy format under the public default SECRET_KEY, over a private legacy pair too', () => {
    const cipher = buildDataDbUrlCipher({ SECRET_KEY: 'defaultSecretKey', ...LEGACY_ENV });
    const stored = cipher.encrypt(URL);

    expect(cipher.authenticated).toBe(false);
    expect(isEncryptedSecretValue(stored)).toBe(false);
    expect(open(LEGACY_ENV, stored)).toEqual({ url: URL });
    expect(cipher.usesPublicKey).toBe(false);
  });

  it('keeps the superseded dedicated root as the root while it is set, as the release that had it', () => {
    const ownRoot = 'BACKEND_DATA_DB_URL_ENCRYPTION_SECRET';
    const secretKeyOnly = buildDataDbUrlCipher({ SECRET_KEY: 'instance-secret' });
    const cipher = buildDataDbUrlCipher({ SECRET_KEY: 'instance-secret', [ownRoot]: 'byodb-root' });
    const underSecretKey = secretKeyOnly.encrypt(URL);
    const stored = cipher.encrypt(URL);

    expect(cipher.authenticated).toBe(true);
    expect(cipher.isCurrent(stored)).toBe(true);
    // SECRET_KEY behind it only reads
    expect(cipher.decrypt(underSecretKey)).toBe(URL);
    expect(cipher.isCurrent(underSecretKey)).toBe(false);
    // and does not open what the dedicated root wrote
    expect(() => secretKeyOnly.decrypt(stored)).toThrow('BYODB URL decryption failed');
    // it comes ahead of the stored credential root too
    const withStored = buildDataDbUrlCipher({
      SECRET_KEY: 'instance-secret',
      BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET: 'stored-root',
      [ownRoot]: 'byodb-root',
    });
    expect(withStored.isCurrent(stored)).toBe(true);
    // on its own it switches the format, unless it is the public default
    expect(buildDataDbUrlCipher({ [ownRoot]: 'byodb-root' }).authenticated).toBe(true);
    expect(buildDataDbUrlCipher({ [ownRoot]: 'defaultSecretKey' }).authenticated).toBe(false);
  });

  it('retires the dedicated root like any other: its value in _OLD keeps opening what it wrote', () => {
    const stored = buildDataDbUrlCipher({
      SECRET_KEY: 'instance-secret',
      BACKEND_DATA_DB_URL_ENCRYPTION_SECRET: 'byodb-root',
    }).encrypt(URL);
    const after = buildDataDbUrlCipher({ SECRET_KEY: 'instance-secret', [ROOT_OLD]: 'byodb-root' });

    expect(after.decrypt(stored)).toBe(URL);
    expect(after.isCurrent(stored)).toBe(false);
    expect(after.isCurrent(after.encrypt(URL))).toBe(true);
  });

  it('takes the stored credential root ahead of SECRET_KEY, which keeps opening what it wrote', () => {
    const storedRoot = 'BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET';
    const before = buildDataDbUrlCipher({ SECRET_KEY: 'instance-secret' }).encrypt(URL);
    const after = buildDataDbUrlCipher({
      SECRET_KEY: 'instance-secret',
      [storedRoot]: 'stored-root',
    });

    expect(after.authenticated).toBe(true);
    expect(after.decrypt(before)).toBe(URL);
    expect(after.isCurrent(before)).toBe(false);
    expect(after.isCurrent(after.encrypt(URL))).toBe(true);
    // every reader gets the root as _OLD first: it opens what the root writes, writes nothing
    const prepared = buildDataDbUrlCipher({
      SECRET_KEY: 'instance-secret',
      [`${storedRoot}_OLD`]: 'stored-root',
    });
    expect(prepared.decrypt(after.encrypt(URL))).toBe(URL);
    expect(prepared.isCurrent(before)).toBe(true);
    // a private stored credential root alone switches the format; its public default does not
    expect(buildDataDbUrlCipher({ [storedRoot]: 'stored-root' }).authenticated).toBe(true);
    expect(buildDataDbUrlCipher({ [storedRoot]: 'defaultSecretKey' }).authenticated).toBe(false);
  });

  it('opens what the previous SECRET_KEY wrote once that value is kept as the root _OLD', () => {
    const before = buildDataDbUrlCipher({ SECRET_KEY: 'old-root' }).encrypt(URL);
    const after = buildDataDbUrlCipher({ SECRET_KEY: 'new-root', [ROOT_OLD]: 'old-root' });

    expect(after.decrypt(before)).toBe(URL);
    expect(after.isCurrent(before)).toBe(false);
    expect(buildDataDbUrlCipher({ SECRET_KEY: 'new-root' }).decrypt(after.encrypt(URL))).toBe(URL);
    expect(() => buildDataDbUrlCipher({ SECRET_KEY: 'new-root' }).decrypt(before)).toThrow(
      'BYODB URL decryption failed'
    );
  });

  it('the root _OLD only decrypts: it does not switch a deployment to the authenticated format', () => {
    const written = buildDataDbUrlCipher({ SECRET_KEY: 'instance-secret' }).encrypt(URL);
    const reader = buildDataDbUrlCipher({ ...LEGACY_ENV, [ROOT_OLD]: 'instance-secret' });

    expect(reader.decrypt(written)).toBe(URL);
    expect(reader.authenticated).toBe(false);
    expect(isEncryptedSecretValue(reader.encrypt(URL))).toBe(false);
    expect(reader.isCurrent(written)).toBe(false);
  });

  it('the legacy pair _OLD does not open the authenticated format, whatever is derived into it', () => {
    const before = buildDataDbUrlCipher({ SECRET_KEY: 'old-root' }).encrypt(URL);
    // the pair the legacy format derives from the previous SECRET_KEY
    const derived = createHash('sha256').update('old-root').digest('hex').slice(0, 16);

    expect(() =>
      buildDataDbUrlCipher({
        SECRET_KEY: 'new-root',
        BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD: derived,
        BACKEND_DATA_DB_URL_ENCRYPTION_IV_OLD: derived,
      }).decrypt(before)
    ).toThrow('BYODB URL decryption failed');
  });

  it('keeps the access-token pair as the legacy writer where the pair falls back to it', () => {
    const stored = storedUnder('private-pat-key0', 'private-pat-iv00');
    const legacy = buildDataDbUrlCipher(PAT_ENV);

    expect(legacy.decrypt(stored)).toBe(URL);
    expect(legacy.isCurrent(stored)).toBe(true);
    // the legacy format has a fixed key and iv, so the same URL encrypts to the same value
    expect(legacy.encrypt(URL)).toBe(stored);

    // a private SECRET_KEY moves new URLs to the authenticated format; the stored one stays
    // readable and a convergence rewrites it
    const switched = buildDataDbUrlCipher({ ...PAT_ENV, SECRET_KEY: 'instance-secret' });
    expect(switched.decrypt(stored)).toBe(URL);
    expect(switched.isCurrent(stored)).toBe(false);
  });

  it('does not store a value that already carries the cipher prefix', () => {
    const cipher = buildDataDbUrlCipher(SWITCHED_ENV);

    expect(() => cipher.encrypt(cipher.encrypt(URL))).toThrow('Encryption failed');
  });

  it.each([
    ['nothing is configured', {}, true],
    ['SECRET_KEY is its public default', { SECRET_KEY: 'defaultSecretKey' }, true],
    ['a private legacy pair is set', LEGACY_ENV, false],
    ['SECRET_KEY is private', { SECRET_KEY: 'instance-secret' }, false],
    ['only a private access-token pair is set, which then writes', PAT_ENV, false],
    [
      'the access-token pair it falls back to is on its public defaults',
      {
        BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: SECRET_SPECS.accessTokenEncryptionKey.legacyDefault,
        BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: SECRET_SPECS.accessTokenEncryptionIv.legacyDefault,
      },
      true,
    ],
  ])('usesPublicKey follows the key new URLs are written under: %s', (_case, env, expected) => {
    expect(buildDataDbUrlCipher(env).usesPublicKey).toBe(expected);
  });
});
