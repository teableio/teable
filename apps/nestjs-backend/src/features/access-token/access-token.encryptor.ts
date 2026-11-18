import { createHmac } from 'node:crypto';
import { authConfig } from '../../configs/auth.config';
import type { ICipherEntry } from '../../utils/encryptor';
import { Encryptor } from '../../utils/encryptor';

interface ITokenEncryptor {
  sign: string;
}

/**
 * Separates the tag from the random part of a sign. Random parts use 0-9a-zA-Z only, so a sign
 * without it was issued before signs carried a tag.
 */
export const SIGN_TAG_SEPARATOR = '.';
/** Hex digits of a tag: plenty to tell apart the few key/iv pairs one deployment goes through. */
export const SIGN_TAG_LENGTH = 6;
/**
 * Characters of the random part. With the tag and the separator a sign is 20 characters, so
 * `{"sign":"…"}` stays under two AES blocks and tokens keep the length they had with the
 * 16-character signs issued before tags.
 */
export const SIGN_RANDOM_LENGTH = 13;

const TAGGED_SIGN = new RegExp(`^[0-9a-f]{${SIGN_TAG_LENGTH}}\\${SIGN_TAG_SEPARATOR}`);

/** Short fingerprint of a key/iv pair (not reversible to either). */
export const signTagOf = (entry: Pick<ICipherEntry, 'key' | 'iv'>) =>
  createHmac('sha256', entry.key)
    .update('teable:access-token-sign-tag:')
    .update(entry.iv)
    .digest('hex')
    .slice(0, SIGN_TAG_LENGTH);

/** The tag a sign carries; undefined for a sign issued before signs carried one. */
export const signTagIn = (sign: string): string | undefined =>
  TAGGED_SIGN.test(sign) ? sign.slice(0, SIGN_TAG_LENGTH) : undefined;

export interface ISignTags {
  /** Pairs this deployment issues under: the primary, and the upcoming pair it switches to. */
  current: string[];
  /** Older pairs it only decrypts with (an _OLD pair, the public pair). */
  decryptOnly: string[];
  /**
   * Of those, the pair an operator pinned in _OLD during a rotation: it goes once the rotation is
   * over, and tokens it sealed stop then. The public pairs kept for tokens issued before a switch
   * stay while no dedicated pair is set.
   */
  pinned: string[];
}

let accessTokenEncryptor: Encryptor<ITokenEncryptor>;
// The entry that issues tokens, and the tag of every entry, from the same config read as the
// encryptor (authConfig() builds a new object on every call, so identity only holds within one
// read).
let primaryEntry: ICipherEntry;
let tagByEntry: Map<ICipherEntry, string>;
let tags: ISignTags;

const getAccessTokenEncryptor = () => {
  if (!accessTokenEncryptor) {
    const { encryption } = authConfig().accessToken;
    const { entries } = encryption;
    primaryEntry = entries[0];
    tagByEntry = new Map(entries.map((entry) => [entry, signTagOf(entry)]));
    const issuesUnder = (entry: ICipherEntry) => entry === primaryEntry || Boolean(entry.upcoming);
    const decryptOnly = entries.filter((entry) => !issuesUnder(entry));
    tags = {
      current: entries.filter(issuesUnder).map((entry) => tagByEntry.get(entry)!),
      decryptOnly: decryptOnly.map((entry) => tagByEntry.get(entry)!),
      pinned: decryptOnly.filter((entry) => entry.pinned).map((entry) => tagByEntry.get(entry)!),
    };
    accessTokenEncryptor = new Encryptor<ITokenEncryptor>({ ...encryption, encoding: 'base64' });
  }
  return accessTokenEncryptor;
};

/** The tag of the pair new tokens are issued under. */
export const currentSignTag = () => {
  getAccessTokenEncryptor();
  return tagByEntry.get(primaryEntry)!;
};

/** The tags of the pairs this deployment accepts: the ones it issues under, and older ones. */
export const signTags = (): ISignTags => {
  getAccessTokenEncryptor();
  return tags;
};

export const getAccessToken = (accessTokenId: string, sign: string) => {
  return `${authConfig().accessToken.prefix}_${accessTokenId}_${getAccessTokenEncryptor().encrypt({
    sign,
  })}`;
};

export const splitAccessToken = (accessToken: string) => {
  const [prefix = '', accessTokenId = '', encryptedSign = ''] = accessToken.split('_');
  if (!accessTokenId) {
    return null;
  }
  if (prefix !== authConfig().accessToken.prefix) {
    return null;
  }
  let sign: string | null = null;
  let entry: ICipherEntry;
  try {
    ({
      data: { sign },
      entry,
    } = getAccessTokenEncryptor().decryptWithEntry(encryptedSign));
  } catch (error) {
    return null;
  }
  if (!sign) {
    return null;
  }
  // A tagged sign is sealed under the pair its tag names: every token this server issues is.
  // Sealed under another pair it still accepts (the public one, say), the sign was put there by
  // someone else, so the token is refused. Signs from before the tags can't be checked and go
  // on as before.
  const tag = signTagIn(sign);
  if (tag !== undefined && tag !== tagByEntry.get(entry)) {
    return null;
  }
  return { prefix, accessTokenId, sign };
};
