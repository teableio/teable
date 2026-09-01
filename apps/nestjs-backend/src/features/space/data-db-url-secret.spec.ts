import { describe, expect, it } from 'vitest';
import { Encryptor } from '../../utils/encryptor';
import { buildDataDbUrlCipherEntries } from './data-db-url-secret';

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
