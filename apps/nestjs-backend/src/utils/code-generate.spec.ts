import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { baseConfig } from '../configs/base.config';
import { generateInvitationCode, isValidInvitationCode } from './code-generate';

const sign = (key: string, id: string) => createHmac('sha256', key).update(id).digest('hex');
const KEYS = ['BACKEND_INVITATION_SECRET', 'BACKEND_INVITATION_SECRET_OLD'] as const;

describe('invitation codes', () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    for (const key of KEYS) delete process.env[key];
  });
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('signs with SECRET_KEY itself while BACKEND_INVITATION_SECRET is unset, as before', () => {
    expect(generateInvitationCode('invabc')).toBe(sign(baseConfig().secretKey, 'invabc'));
  });

  it('signs with BACKEND_INVITATION_SECRET once set', () => {
    process.env.BACKEND_INVITATION_SECRET = 'invitation-secret';
    expect(generateInvitationCode('invabc')).toBe(sign('invitation-secret', 'invabc'));
    expect(isValidInvitationCode('invabc', sign('invitation-secret', 'invabc'))).toBe(true);
    expect(isValidInvitationCode('invother', sign('invitation-secret', 'invabc'))).toBe(false);
  });

  it('accepts a code from before the change only while _OLD holds the previous secret', () => {
    process.env.BACKEND_INVITATION_SECRET = 'new-invitation-secret';
    const issuedBefore = sign('previous-secret', 'invabc');

    expect(isValidInvitationCode('invabc', issuedBefore)).toBe(false);

    process.env.BACKEND_INVITATION_SECRET_OLD = 'previous-secret';
    expect(isValidInvitationCode('invabc', issuedBefore)).toBe(true);
    // the current secret keeps working alongside
    expect(isValidInvitationCode('invabc', sign('new-invitation-secret', 'invabc'))).toBe(true);
  });

  it('rejects codes under any other key, and malformed ones', () => {
    process.env.BACKEND_INVITATION_SECRET_OLD = 'previous-secret';
    expect(isValidInvitationCode('invabc', sign('some-other-key', 'invabc'))).toBe(false);
    expect(isValidInvitationCode('invabc', '')).toBe(false);
    expect(isValidInvitationCode('invabc', 'short')).toBe(false);
  });
});
