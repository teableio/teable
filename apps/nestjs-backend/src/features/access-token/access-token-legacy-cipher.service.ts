import { Injectable } from '@nestjs/common';
import type { Prisma } from '@teable/db-main-prisma';
import type { ISignTags } from './access-token.encryptor';
import { SIGN_TAG_SEPARATOR, signTagIn, signTags } from './access-token.encryptor';

const DAY_MS = 24 * 60 * 60 * 1000;
// A token is only suggested for regenerating while it has over a week to go: within a week the
// token list already shows it expiring, and it gets replaced then. Under a public pair, which
// stays, it must also be meant to live long: a shorter one is replaced by a tagged one when it
// expires. 80 days keeps clear of the 60 and 90 day presets, whose real length drifts by the
// timezone the expiry date was picked in.
export const ROTATE_HINT_MIN_VALIDITY_MS = 80 * DAY_MS;
export const ROTATE_HINT_MIN_REMAINING_MS = 7 * DAY_MS;

const taggedWith = (tag: string): Prisma.AccessTokenWhereInput => ({
  sign: { startsWith: `${tag}${SIGN_TAG_SEPARATOR}` },
});

export interface ILegacyCipherMark {
  /**
   * Its key/iv is no longer accepted at all, so the token no longer works. Otherwise it still
   * works under an older key/iv this deployment only decrypts with.
   */
  stopped: boolean;
}

export interface ITokenToMark {
  id: string;
  sign: string;
  expiredTime: Date | string;
  createdTime: Date | string;
}

const markOf = (
  token: ITokenToMark,
  { current, decryptOnly, pinned }: ISignTags,
  now: number
): ILegacyCipherMark | undefined => {
  const expiresAt = new Date(token.expiredTime).getTime();
  if (expiresAt <= now) return undefined;
  const tag = signTagIn(token.sign);
  if (tag === undefined) {
    // With no older pair, an untagged token that still works can only be under the current pair.
    if (!decryptOnly.length) return undefined;
  } else if (current.includes(tag)) {
    return undefined;
  } else if (!decryptOnly.includes(tag)) {
    return { stopped: true };
  }
  // Left: tagged with an older pair, or untagged while there is one.
  if (expiresAt - now <= ROTATE_HINT_MIN_REMAINING_MS) return undefined;
  const mayBePinned = tag === undefined ? pinned.length > 0 : pinned.includes(tag);
  const validity = expiresAt - new Date(token.createdTime).getTime();
  return mayBePinned || validity > ROTATE_HINT_MIN_VALIDITY_MS ? { stopped: false } : undefined;
};

/**
 * Personal access tokens (not OAuth app tokens) not issued under the key/iv this deployment
 * issues under now. Nothing retires on a date: an older key/iv keeps opening tokens until the
 * deployment removes it.
 *
 * A token is `teable_<id>_<AES(sign)>` and only `sign` is stored. Signs issued since this code
 * carry the tag of the pair that sealed them (generateSign), so a stored sign tells whether the
 * token is under a pair in use, under an older pair this deployment only decrypts with (an _OLD
 * pair, or a public pair kept for tokens issued before the switch), or under none it accepts.
 * A sign without a tag predates the tags: the pair that sealed it can't be told (one deployment
 * may hold some under the public pair and later ones under the pair derived from SECRET_KEY),
 * and only the token in its holder's hands could be tried against them. It is taken as working,
 * never as stopped, and admins see how many there are. While this deployment still decrypts with
 * an older pair, one may be under it, and with no tag to check it is also the kind a leaked sign
 * can be sealed into under a public pair. With no older pair, one that still works can only be
 * under the current pair.
 *
 * A token that may be under an older pair is suggested for regenerating while it has over 7
 * days left. One that may be under the pair pinned in _OLD (tagged with it, or untagged while
 * there is one) stops once the rotation is over, however long it was meant to live. Under a
 * public pair it keeps working, and only one meant to live long (valid for over 80 days) is
 * suggested.
 */
@Injectable()
export class AccessTokenLegacyCipherService {
  /**
   * Not expired yet and tagged with an older pair that still opens them; undefined when this
   * deployment has no older pair, so no token is under one.
   */
  oldKeyWhere(now: Date): Prisma.AccessTokenWhereInput | undefined {
    const { decryptOnly } = signTags();
    if (!decryptOnly.length) return undefined;
    return {
      clientId: null,
      expiredTime: { gt: now },
      OR: decryptOnly.map(taggedWith),
    };
  }

  /** Not expired yet and tagged with a pair this deployment no longer accepts: they stopped. */
  stoppedWhere(now: Date): Prisma.AccessTokenWhereInput {
    const { current, decryptOnly } = signTags();
    return {
      clientId: null,
      expiredTime: { gt: now },
      sign: { contains: SIGN_TAG_SEPARATOR },
      NOT: [...current, ...decryptOnly].map(taggedWith),
    };
  }

  /** Not expired yet and issued before signs carried a tag: which pair sealed them is unknown. */
  untaggedWhere(now: Date): Prisma.AccessTokenWhereInput {
    return {
      clientId: null,
      expiredTime: { gt: now },
      NOT: { sign: { contains: SIGN_TAG_SEPARATOR } },
    };
  }

  /**
   * The mark of each listed token that stopped, or that may be under an older pair and has over
   * 7 days left: any such one while that pair may be the one pinned in _OLD, otherwise only one
   * meant to live long (valid for over 80 days).
   */
  marksOf(tokens: ITokenToMark[]): Map<string, ILegacyCipherMark> {
    const marks = new Map<string, ILegacyCipherMark>();
    const tags = signTags();
    const now = Date.now();
    for (const token of tokens) {
      const mark = markOf(token, tags, now);
      if (mark) marks.set(token.id, mark);
    }
    return marks;
  }
}
