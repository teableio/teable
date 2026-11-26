import { createHash } from 'node:crypto';
import { dedupeCipherEntries } from '../../configs/secrets/resolve-cipher-entries';
import { SECRET_SPECS, writesAuthenticatedDataDbUrls } from '../../configs/secrets/secret-specs';
import { STORED_SECRET_PURPOSES } from '../../configs/secrets/stored-secret-roots';
import type { ICipherEntry } from '../../utils/encryptor';
import { Encryptor } from '../../utils/encryptor';
import { isEncryptedSecretValue, SecretValueCodec } from '../../utils/secret-value-codec';

type IDataDbUrlSecret = {
  url: string;
};

type IEnv = Record<string, string | undefined>;

// Legacy SECRET_KEY derivation, kept verbatim for ciphertext compatibility:
// deployments without a dedicated key encrypted their BYODB URLs under
// sha256(SECRET_KEY ?? public literal) — note key and iv derive from the SAME
// input when SECRET_KEY is set, a historical quirk that must not change while
// such ciphertext exists.
const legacyDerived = (secretKey: string | undefined, fallbackLiteral: string) =>
  createHash('sha256')
    .update(secretKey ?? fallbackLiteral)
    .digest('hex')
    .slice(0, 16);

/**
 * Cipher entries of the legacy format (entries[0] encrypts, all decrypt): a
 * fixed key and iv, no authentication. This site does not use
 * resolveCipherEntries: its historical resolution chain (the access-token
 * coupling of T6475 and the key==iv quirk above) stays the writer EXACTLY as
 * before — deploying the rotation mechanism changes no deployment's
 * encrypting key. The decrypt-only tail carries the operator-pinned `_OLD`
 * generations of the dedicated and access-token pairs; SECRET_KEY itself is
 * not a rotation target.
 */
export const buildDataDbUrlCipherEntries = (env: IEnv = process.env): ICipherEntry[] => {
  const algorithm = env.BACKEND_DATA_DB_URL_ENCRYPTION_ALGORITHM ?? 'aes-128-cbc';

  // The pre-rotation resolution chain, verbatim (including `??` semantics).
  const primary: ICipherEntry = {
    algorithm,
    key:
      env.BACKEND_DATA_DB_URL_ENCRYPTION_KEY ??
      env.BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY ??
      legacyDerived(env.SECRET_KEY, 'teable-data-db-url-secret'),
    iv:
      env.BACKEND_DATA_DB_URL_ENCRYPTION_IV ??
      env.BACKEND_ACCESS_TOKEN_ENCRYPTION_IV ??
      legacyDerived(env.SECRET_KEY, 'teable-data-db-url-secret-iv'),
  };

  const entries: ICipherEntry[] = [primary];

  // Previous dedicated pair, pinned during a planned rotation. The pair
  // travels as a group like the main vars — half a pair would strand old
  // ciphertext, so it fails loudly at config load. The algorithm is not a
  // rotation target (see resolveCipherEntries) — the entry inherits it.
  const oldKey = env.BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD;
  const oldIv = env.BACKEND_DATA_DB_URL_ENCRYPTION_IV_OLD;
  if (Boolean(oldKey) !== Boolean(oldIv)) {
    throw new Error(
      'BACKEND_DATA_DB_URL_ENCRYPTION_KEY_OLD and BACKEND_DATA_DB_URL_ENCRYPTION_IV_OLD must be ' +
        'set together — copy the unchanged half of the pair explicitly when only one half rotated'
    );
  }
  if (oldKey && oldIv) {
    entries.push({ algorithm, key: oldKey, iv: oldIv });
  }

  // URLs written while the chain fell through to a since-rotated
  // access-token pair. The coupled era used the PAT iv when it was
  // configured and this purpose's literal-derived iv otherwise — push BOTH
  // candidates and let trial decryption pick (dedupe drops a collision).
  const patOldKey = env.BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY_OLD;
  const patOldIv = env.BACKEND_ACCESS_TOKEN_ENCRYPTION_IV_OLD;
  if (patOldKey && patOldIv) {
    entries.push(
      { algorithm, key: patOldKey, iv: patOldIv },
      { algorithm, key: patOldKey, iv: primary.iv }
    );
  }

  return dedupeCipherEntries(entries);
};

// The legacy primaries anyone can compute: the zero-config literal pair, and
// the pairs the chain reaches from a public value — SECRET_KEY on its own
// default (derived), or the access-token pair pinned to its defaults (used
// as is).
const PUBLIC_LEGACY_ENVS: IEnv[] = [
  {},
  { SECRET_KEY: SECRET_SPECS.secretKey.legacyDefault },
  {
    BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY: SECRET_SPECS.accessTokenEncryptionKey.legacyDefault,
    BACKEND_ACCESS_TOKEN_ENCRYPTION_IV: SECRET_SPECS.accessTokenEncryptionIv.legacyDefault,
  },
];

const isPublicLegacyPrimary = (primary: ICipherEntry): boolean =>
  PUBLIC_LEGACY_ENVS.some((env) => {
    const [publicPrimary] = buildDataDbUrlCipherEntries(env);
    return publicPrimary.key === primary.key && publicPrimary.iv === primary.iv;
  });

export interface IDataDbUrlCipher {
  /** Whether new URLs are written in the authenticated format. */
  readonly authenticated: boolean;
  /** Whether the key new URLs are written under is one anyone can compute. */
  readonly usesPublicKey: boolean;
  encrypt(url: string): string;
  decrypt(encryptedUrl: string): string;
  /** Whether the stored value is what encrypt() writes: its format, under its key. */
  isCurrent(encryptedUrl: string): boolean;
}

/**
 * BYODB URLs are stored in one of two formats, told apart by the cipher
 * prefix (legacy ciphertext is bare hex, so it never carries it):
 *
 * - authenticated: AES-256-GCM under an HKDF key of the root secret, a random
 *   nonce per value and the auth tag stored with it (SecretValueCodec). A
 *   tampered value fails to open instead of decrypting to something else.
 * - legacy: the fixed key/iv chain above.
 *
 * Both are always readable. The root resolves like every stored-secret purpose
 * (resolveStoredSecretRoots): the format's superseded dedicated var
 * BACKEND_DATA_DB_URL_ENCRYPTION_SECRET while it is set, else the stored
 * credential root, else SECRET_KEY. New URLs are written in the authenticated
 * format once that root is a private value (writesAuthenticatedDataDbUrls), and
 * in the legacy one while it is unset or the public default. The roots that
 * only decrypt are the ones the resolver lists: what comes later in that order
 * and is also set, the stored credential root's `_OLD` var, and
 * BACKEND_DATA_DB_URL_ENCRYPTION_SECRET_OLD, which holds a previous root of this
 * format alone. The legacy pair's `_OLD` vars do not open this format.
 */
export const buildDataDbUrlCipher = (env: IEnv = process.env): IDataDbUrlCipher => {
  const entries = buildDataDbUrlCipherEntries(env);
  const legacy = new Encryptor<IDataDbUrlSecret>({ entries });
  const legacyPrimary = new Encryptor<IDataDbUrlSecret>({ entries: [entries[0]] });
  const codec = new SecretValueCodec(
    {
      purpose: STORED_SECRET_PURPOSES.dataDbUrl,
      hkdfInfo: 'teable:data-db-url',
      label: 'BYODB URL',
    },
    env
  );
  const authenticated = writesAuthenticatedDataDbUrls(env);

  const opensWithLegacyPrimary = (encryptedUrl: string): boolean => {
    try {
      legacyPrimary.decrypt(encryptedUrl);
      return true;
    } catch {
      return false;
    }
  };

  return {
    authenticated,
    get usesPublicKey() {
      return authenticated ? codec.usesPublicDefaultRoot : isPublicLegacyPrimary(entries[0]);
    },
    encrypt(url) {
      if (!authenticated) {
        return legacy.encrypt({ url });
      }
      // The codec stores an already-prefixed value as it is, so a "URL" made of
      // another row's ciphertext would be kept and later open as that row's URL.
      if (isEncryptedSecretValue(url)) {
        throw new Error('Encryption failed');
      }
      return codec.encryptValue(url);
    },
    decrypt(encryptedUrl) {
      return isEncryptedSecretValue(encryptedUrl)
        ? codec.decryptValueStrict(encryptedUrl)
        : legacy.decrypt(encryptedUrl).url;
    },
    isCurrent(encryptedUrl) {
      return authenticated
        ? codec.isCurrentValue(encryptedUrl)
        : !isEncryptedSecretValue(encryptedUrl) && opensWithLegacyPrimary(encryptedUrl);
    },
  };
};

export const encryptDataDbUrl = (url: string) => buildDataDbUrlCipher().encrypt(url);

export const decryptDataDbUrl = (encryptedUrl: string) =>
  buildDataDbUrlCipher().decrypt(encryptedUrl);
