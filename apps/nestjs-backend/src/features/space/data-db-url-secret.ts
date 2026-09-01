import { createHash } from 'crypto';
import { dedupeCipherEntries } from '../../configs/secrets/resolve-cipher-entries';
import type { ICipherEntry } from '../../utils/encryptor';
import { Encryptor } from '../../utils/encryptor';

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
 * Cipher entries for BYODB URLs (entries[0] encrypts, all decrypt). This site
 * does not use resolveCipherEntries: its historical resolution chain (the
 * access-token coupling of T6475 and the key==iv quirk above) stays the
 * writer EXACTLY as before — deploying the rotation mechanism changes no
 * deployment's encrypting key. The decrypt-only tail carries the operator-
 * pinned `_OLD` generations of the dedicated and access-token pairs;
 * SECRET_KEY itself is not a rotation target.
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
    entries.push({ algorithm, key: patOldKey, iv: patOldIv });
    entries.push({ algorithm, key: patOldKey, iv: primary.iv });
  }

  return dedupeCipherEntries(entries);
};

const getDataDbUrlEncryptor = () =>
  new Encryptor<IDataDbUrlSecret>({ entries: buildDataDbUrlCipherEntries() });

export const encryptDataDbUrl = (url: string) => getDataDbUrlEncryptor().encrypt({ url });

export const decryptDataDbUrl = (encryptedUrl: string) =>
  getDataDbUrlEncryptor().decrypt(encryptedUrl).url;
