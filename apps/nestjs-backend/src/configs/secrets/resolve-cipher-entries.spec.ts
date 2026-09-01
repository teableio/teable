import { describe, expect, it } from 'vitest';
import { resolveCipherEntries } from './resolve-cipher-entries';
import { SECRET_SPECS } from './secret-specs';

const ALGORITHM = 'aes-128-cbc';
const DEFAULT_KEY = SECRET_SPECS.accessTokenEncryptionKey.legacyDefault!;
const DEFAULT_IV = SECRET_SPECS.accessTokenEncryptionIv.legacyDefault!;

const resolve = (env: Record<string, string | undefined>) =>
  resolveCipherEntries({
    algorithm: ALGORITHM,
    keySpec: SECRET_SPECS.accessTokenEncryptionKey,
    ivSpec: SECRET_SPECS.accessTokenEncryptionIv,
    env,
  });

describe('resolveCipherEntries', () => {
  it('zero config → the public default is the single (encrypting) entry', () => {
    expect(resolve({})).toEqual([{ algorithm: ALGORITHM, key: DEFAULT_KEY, iv: DEFAULT_IV }]);
  });

  it('SECRET_KEY never changes the encrypting key — the legacy default stays the writer', () => {
    // Self-hosted deployments keep the pre-rotation behavior byte-for-byte:
    // SECRET_KEY plays no role for purposes that carry a legacy default.
    expect(resolve({ SECRET_KEY: 'root', SECRET_KEY_OLD: 'old-root' })).toEqual([
      { algorithm: ALGORITHM, key: DEFAULT_KEY, iv: DEFAULT_IV },
    ]);
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
