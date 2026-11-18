import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenLegacyCipherService } from './access-token-legacy-cipher.service';

const { tags } = vi.hoisted(() => ({
  tags: { current: ['cccccc'], decryptOnly: ['aaaaaa'], pinned: [] } as {
    current: string[];
    decryptOnly: string[];
    pinned: string[];
  },
}));
vi.mock('./access-token.encryptor', () => ({
  SIGN_TAG_SEPARATOR: '.',
  signTagIn: (sign: string) => (/^[0-9a-f]{6}\./.test(sign) ? sign.slice(0, 6) : undefined),
  signTags: () => tags,
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-17T00:00:00.000Z');
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY);
const NEVER = new Date('2099-12-31T00:00:00.000Z');

// Created long ago and valid for long: the ones a hint is about.
const token = (id: string, sign: string, expiredTime: Date, createdTime = daysFromNow(-300)) => ({
  id,
  sign,
  expiredTime,
  createdTime,
});

// An _OLD pair next to the public one 'aaaaaa'.
const pinOld = () => {
  tags.decryptOnly = ['aaaaaa', 'eeeeee'];
  tags.pinned = ['eeeeee'];
};

describe('AccessTokenLegacyCipherService', () => {
  const service = new AccessTokenLegacyCipherService();

  beforeEach(() => {
    tags.current = ['cccccc'];
    tags.decryptOnly = ['aaaaaa'];
    tags.pinned = [];
    vi.useFakeTimers({ now: NOW });
    return () => vi.useRealTimers();
  });

  it('selects tokens not expired yet tagged with an older pair, while there is one', () => {
    expect(service.oldKeyWhere(NOW)).toEqual({
      clientId: null,
      expiredTime: { gt: NOW },
      OR: [{ sign: { startsWith: 'aaaaaa.' } }],
    });
    tags.decryptOnly = [];
    expect(service.oldKeyWhere(NOW)).toBeUndefined();
  });

  it('selects tokens not expired yet whose tag no accepted pair has', () => {
    tags.current = ['cccccc', 'dddddd'];

    expect(service.stoppedWhere(NOW)).toEqual({
      clientId: null,
      expiredTime: { gt: NOW },
      sign: { contains: '.' },
      NOT: [
        { sign: { startsWith: 'cccccc.' } },
        { sign: { startsWith: 'dddddd.' } },
        { sign: { startsWith: 'aaaaaa.' } },
      ],
    });
  });

  it('selects tokens not expired yet without a tag apart', () => {
    expect(service.untaggedWhere(NOW)).toEqual({
      clientId: null,
      expiredTime: { gt: NOW },
      NOT: { sign: { contains: '.' } },
    });
  });

  it('marks a token whose pair is no longer accepted as stopped, until it expires', () => {
    const marks = service.marksOf([
      token('accGone', 'bbbbbb.abc', daysFromNow(5), daysFromNow(-10)),
      token('accGoneExpired', 'bbbbbb.abc', daysFromNow(-1)),
      token('accCurrent', 'cccccc.abc', NEVER),
    ]);

    expect(Object.fromEntries(marks)).toEqual({ accGone: { stopped: true } });
  });

  it('suggests regenerating a long-lived token tagged with an older public pair', () => {
    const marks = service.marksOf([
      token('accOld', 'aaaaaa.abc', NEVER),
      // valid for 90 days in all, 60 left: long-lived enough
      token('accNinety', 'aaaaaa.abc', daysFromNow(60), daysFromNow(-30)),
    ]);

    expect(Object.fromEntries(marks)).toEqual({
      accOld: { stopped: false },
      accNinety: { stopped: false },
    });
  });

  it('leaves short-lived ones under a public pair and ones about to expire alone', () => {
    const marks = service.marksOf([
      // valid for 60 days in all: replaced by a tagged one when it expires
      token('accShort', 'aaaaaa.abc', daysFromNow(30), daysFromNow(-30)),
      // valid for long, but 7 days or less left: the list already shows it expiring
      token('accEnding', 'aaaaaa.abc', daysFromNow(7)),
      // just over both lines
      token('accJustOver', 'aaaaaa.abc', daysFromNow(8), daysFromNow(-73)),
    ]);

    expect(Object.fromEntries(marks)).toEqual({ accJustOver: { stopped: false } });
  });

  it('suggests regenerating any token under the pair pinned in _OLD with over 7 days left', () => {
    pinOld();
    const marks = service.marksOf([
      // valid for 30 days in all, 20 left: it would stop once _OLD goes
      token('accPinned', 'eeeeee.abc', daysFromNow(20), daysFromNow(-10)),
      token('accPinnedNever', 'eeeeee.abc', NEVER),
      // 7 days or less left: the list already shows it expiring
      token('accPinnedEnding', 'eeeeee.abc', daysFromNow(7), daysFromNow(-23)),
      // the same 30 days under the public pair, which stays: left alone
      token('accPublicShort', 'aaaaaa.abc', daysFromNow(20), daysFromNow(-10)),
    ]);

    expect(Object.fromEntries(marks)).toEqual({
      accPinned: { stopped: false },
      accPinnedNever: { stopped: false },
    });
  });

  it('suggests regenerating a token without a tag, while there is an older pair', () => {
    const untagged = [
      token('accUntagged', 'legacysign', NEVER),
      // a sign of another shape counts as one without a tag
      token('accLongTag', 'cccccc12.abcdefghijklmnop', NEVER),
      // valid for 60 days in all, 30 left
      token('accUntaggedShort', 'legacysign', daysFromNow(30), daysFromNow(-30)),
      // 7 days or less left, or expired: left alone
      token('accUntaggedEnding', 'legacysign', daysFromNow(5), daysFromNow(-85)),
      token('accUntaggedExpired', 'legacysign', daysFromNow(-1)),
    ];
    // which pair sealed them is unknown: suggested, never stopped. With only a public pair older,
    // as for a token tagged with it, only a long-lived one
    expect(Object.fromEntries(service.marksOf(untagged))).toEqual({
      accUntagged: { stopped: false },
      accLongTag: { stopped: false },
    });

    // with _OLD set it may be under it: any one with over 7 days left
    pinOld();
    expect(Object.fromEntries(service.marksOf(untagged))).toEqual({
      accUntagged: { stopped: false },
      accLongTag: { stopped: false },
      accUntaggedShort: { stopped: false },
    });

    // with no older pair, one that still works can only be under the current pair
    tags.decryptOnly = [];
    tags.pinned = [];
    expect(service.marksOf(untagged)).toEqual(new Map());
  });
});
