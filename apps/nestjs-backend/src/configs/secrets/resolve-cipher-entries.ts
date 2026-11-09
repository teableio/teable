import type { ICipherEntry } from '../../utils/encryptor';
import { resolveSecret } from './resolve-secret';
import type { ISecretSpec } from './secret-specs';

type IEnv = Record<string, string | undefined>;

/** Drop repeated triples while preserving order (entries[0] must stay first). */
export const dedupeCipherEntries = (entries: ICipherEntry[]): ICipherEntry[] => {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const id = JSON.stringify([entry.algorithm, entry.key, entry.iv]);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

/**
 * Build the cipher-entry array for one encryption purpose (see Encryptor:
 * entries[0] encrypts, every entry participates in decryption).
 *
 * The primary is what resolveSecret resolves: the dedicated pair, else the
 * pair derived from SECRET_KEY, else the legacy public default. An unset pair
 * used to encrypt under the legacy literals; consumers whose ciphertext sits
 * in users' hands pass keepLegacyForDecrypt to keep that pair decrypt-only,
 * so what was issued before stays readable. Others leave it out, so what the
 * public pair seals stops verifying. Half a main pair never gets here: the
 * secrets policy refuses to boot on it (secrets-policy.ts).
 *
 * The decrypt-only `_OLD` tail is what an operator pins during
 * a PLANNED rotation: fresh values in the main vars, the previous pair in
 * `<key envKey>_OLD` / `<iv envKey>_OLD`, kept until no ciphertext under it
 * remains. The pair travels as a group like the main vars: copy the
 * unchanged half explicitly. Half a pair throws at boot — silently guessing
 * the missing half would strand the old ciphertext without a trace. The
 * algorithm is deliberately NOT part of the rotation surface (the _OLD
 * entry inherits it): changing the algorithm changes the ciphertext format
 * and is a code-level migration, not a configuration action. If an old key
 * LEAKED, do NOT pin it — hard-cut instead and accept that ciphertext under
 * it becomes unreadable.
 */
export const resolveCipherEntries = (options: {
  algorithm: string;
  keySpec: ISecretSpec;
  ivSpec: ISecretSpec;
  keepLegacyForDecrypt?: boolean;
  env?: IEnv;
}): ICipherEntry[] => {
  const { algorithm, keySpec, ivSpec, keepLegacyForDecrypt = false, env = process.env } = options;

  const primary: ICipherEntry = {
    algorithm,
    key: resolveSecret(keySpec, env),
    iv: resolveSecret(ivSpec, env),
  };

  const entries: ICipherEntry[] = [primary];

  // The pinned pair travels as a group, like the main vars. Half a pair is
  // an explicit misconfiguration that would strand old ciphertext — fail
  // loudly at config load instead of guessing the missing half.
  const oldKey = env[`${keySpec.envKey}_OLD`];
  const oldIv = env[`${ivSpec.envKey}_OLD`];
  if (Boolean(oldKey) !== Boolean(oldIv)) {
    throw new Error(
      `${keySpec.envKey}_OLD and ${ivSpec.envKey}_OLD must be set together — ` +
        'copy the unchanged half of the pair explicitly when only one half rotated'
    );
  }
  if (oldKey && oldIv) {
    entries.push({ algorithm, key: oldKey, iv: oldIv });
  }

  if (
    keepLegacyForDecrypt &&
    !env[keySpec.envKey] &&
    !env[ivSpec.envKey] &&
    keySpec.legacyDefault &&
    ivSpec.legacyDefault
  ) {
    entries.push({ algorithm, key: keySpec.legacyDefault, iv: ivSpec.legacyDefault });
  }

  return dedupeCipherEntries(entries);
};
