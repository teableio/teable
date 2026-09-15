import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheService } from '../../../cache/cache.service';
import type { IAuthConfig } from '../../../configs/auth.config';
import type { UserService } from '../../user/user.service';
import type { SessionStoreService } from '../session/session-store.service';
import { MobileAuthService } from './mobile-auth.service';
import { hashCode, sha256Base64url, verifyS256 } from './pkce';

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk_dBjftJeZ4CVP';
const CHALLENGE = sha256Base64url(VERIFIER);
const NATIVE_SID = 'sid-native';

const user = {
  id: 'usr1',
  name: 'Ada',
  email: 'ada@example.com',
  avatar: null,
  phone: null,
  password: 'hash',
  notifyMeta: { email: true },
  isAdmin: null,
  lang: 'en',
  deactivatedTime: null,
};

function makeService(overrides: Partial<typeof user> = {}, liveSessions = new Set([NATIVE_SID])) {
  const store = new Map<string, unknown>();
  const cache = {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => store.delete(key)),
  };
  const users = {
    getUserById: vi.fn(async () => ({ ...user, ...overrides })),
  };
  const sessionStore = {
    get: vi.fn((sid: string, cb: (err: unknown, session?: unknown) => void) =>
      cb(null, liveSessions.has(sid) ? { passport: { user: { id: 'usr1' } } } : null)
    ),
  };
  const config = {
    mobileAuth: {
      redirectSchemes: ['teable'],
      codeExpiresInSeconds: 300,
      webSessionCodeExpiresInSeconds: 120,
    },
  } as unknown as IAuthConfig;
  const service = new MobileAuthService(
    cache as unknown as CacheService,
    users as unknown as UserService,
    sessionStore as unknown as SessionStoreService,
    config
  );
  return { service, cache, users, store, liveSessions };
}

const codeOf = (redirectUrl: string) => new URL(redirectUrl).searchParams.get('code') as string;
const mint = (ctx: ReturnType<typeof makeService>, redirectUri = 'teable://auth/callback') =>
  ctx.service
    .createCode('usr1', { codeChallenge: CHALLENGE, state: 'st', redirectUri })
    .then(({ redirectUrl }) => codeOf(redirectUrl));

describe('pkce', () => {
  it('verifies S256 challenges and rejects malformed input', () => {
    expect(verifyS256(VERIFIER, CHALLENGE)).toBe(true);
    expect(verifyS256(`${VERIFIER}x`, CHALLENGE)).toBe(false);
    expect(verifyS256('short', CHALLENGE)).toBe(false);
    expect(verifyS256(VERIFIER, 'not-a-challenge')).toBe(false);
  });
});

describe('MobileAuthService', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it('binds a single-use code to the user and challenge and returns the app redirect', async () => {
    const { redirectUrl } = await ctx.service.createCode('usr1', {
      codeChallenge: CHALLENGE,
      state: 'st-1',
      redirectUri: 'teable://auth/callback',
    });
    const url = new URL(redirectUrl);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('teable://auth/callback');
    expect(url.searchParams.get('state')).toBe('st-1');
    const code = codeOf(redirectUrl);
    expect(code).toHaveLength(43);
    expect(ctx.store.get(`auth:mobile-code:${hashCode(code)}`)).toMatchObject({
      userId: 'usr1',
      codeChallenge: CHALLENGE,
    });
    expect(ctx.cache.set).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 300);

    const me = await ctx.service.exchange({ code, codeVerifier: VERIFIER });
    expect(me).toMatchObject({ id: 'usr1', email: 'ada@example.com', hasPassword: true });
    await expect(ctx.service.exchange({ code, codeVerifier: VERIFIER })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('keeps query params of the redirect uri and appends code and state', async () => {
    const { redirectUrl } = await ctx.service.createCode('usr1', {
      codeChallenge: CHALLENGE,
      state: 'st',
      redirectUri: 'teable://auth/callback?flavor=dev',
    });
    const url = new URL(redirectUrl);
    expect(url.searchParams.get('flavor')).toBe('dev');
    expect(url.searchParams.get('code')).toBeTruthy();
  });

  it('burns the code when the verifier is wrong', async () => {
    const code = await mint(ctx);
    await expect(ctx.service.exchange({ code, codeVerifier: `${VERIFIER}xx` })).rejects.toThrow(
      'Invalid code_verifier'
    );
    await expect(ctx.service.exchange({ code, codeVerifier: VERIFIER })).rejects.toThrow(
      'Invalid or expired code'
    );
  });

  it('lets only the request that deletes the key consume a code (atomic consume)', async () => {
    const code = await mint(ctx);
    // Simulate a concurrent consumer that already removed the key between get and del.
    ctx.cache.del.mockResolvedValueOnce(false);
    await expect(ctx.service.exchange({ code, codeVerifier: VERIFIER })).rejects.toThrow(
      'Invalid or expired code'
    );
  });

  it('refuses redirect uris outside the allow-listed schemes', async () => {
    for (const redirectUri of [
      'https://evil.example/callback',
      'javascript:alert(1)',
      'teable://auth/callback#frag',
      'not a url',
    ]) {
      await expect(
        ctx.service.createCode('usr1', { codeChallenge: CHALLENGE, state: 'st', redirectUri })
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(ctx.cache.set).not.toHaveBeenCalled();
  });

  it('rejects codes of deactivated or missing users', async () => {
    const deactivated = makeService({ deactivatedTime: '2026-01-01T00:00:00.000Z' as never });
    const code = await mint(deactivated);
    await expect(deactivated.service.exchange({ code, codeVerifier: VERIFIER })).rejects.toThrow(
      'Invalid or expired code'
    );
  });

  it('issues single-use web-session codes bound to the native session', async () => {
    const { code } = await ctx.service.createWebSessionCode('usr1', NATIVE_SID);
    expect(ctx.cache.set).toHaveBeenCalledWith(
      `auth:mobile-web-session:${hashCode(code)}`,
      expect.objectContaining({ userId: 'usr1', parentSessionId: NATIVE_SID }),
      120
    );
    const grant = await ctx.service.consumeWebSessionCode(code);
    expect(grant.user).toMatchObject({ id: 'usr1' });
    expect(grant.parentSessionId).toBe(NATIVE_SID);
    await expect(ctx.service.consumeWebSessionCode(code)).rejects.toThrow(
      'Invalid or expired code'
    );
    await expect(ctx.service.consumeWebSessionCode('nope')).rejects.toThrow(
      'Invalid or expired code'
    );
  });

  it('refuses a web-session code once the native session that minted it is gone', async () => {
    const { code } = await ctx.service.createWebSessionCode('usr1', NATIVE_SID);
    ctx.liveSessions.delete(NATIVE_SID);
    await expect(ctx.service.consumeWebSessionCode(code)).rejects.toThrow(
      'Invalid or expired code'
    );
  });

  it('tracks child sessions under their native session without duplicates', async () => {
    await ctx.service.registerChildSession(NATIVE_SID, 'sid-web-1');
    await ctx.service.registerChildSession(NATIVE_SID, 'sid-web-2');
    await ctx.service.registerChildSession(NATIVE_SID, 'sid-web-1');
    expect(ctx.store.get(`auth:mobile-children:${NATIVE_SID}`)).toEqual(['sid-web-2', 'sid-web-1']);
  });
});
