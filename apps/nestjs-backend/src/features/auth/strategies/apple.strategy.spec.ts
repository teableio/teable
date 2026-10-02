/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import { UnauthorizedException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { authConfig } from '../../../configs/auth.config';
import { baseConfig } from '../../../configs/base.config';
import { UserService } from '../../user/user.service';
import { OauthStoreService } from '../oauth/oauth.store';
import {
  AppleStrategy,
  appleCallbackUrl,
  appleDisplayName,
  decodeAppleIdToken,
  parseAppleUserField,
} from './apple.strategy';

const CLIENT_ID = 'ai.teable.web';
const SUB = '001234.5f6a7b8c9d0e.1234';
const EMAIL = 'jane@privaterelay.appleid.com';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const idTokenWith = (claims: Record<string, unknown> = {}) =>
  `${encode({ alg: 'ES256', kid: 'key' })}.${encode({
    iss: 'https://appleid.apple.com',
    aud: CLIENT_ID,
    sub: SUB,
    email: EMAIL,
    ...claims,
  })}.signature`;

const requestWith = (body: Record<string, unknown> = {}) => ({ body }) as unknown as Request;

const dbUser = {
  id: 'usrApple',
  name: 'Jane Doe',
  email: EMAIL,
  phone: null,
  password: null,
  avatar: null,
  isAdmin: null,
  lang: null,
  notifyMeta: '{}',
  deactivatedTime: null,
};

describe('AppleStrategy', () => {
  let strategy: AppleStrategy;
  const userService = mockDeep<UserService>();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppleStrategy,
        {
          provide: authConfig.KEY,
          useValue: {
            apple: {
              clientID: CLIENT_ID,
              teamID: 'TEAMID',
              keyID: 'KEYID',
              privateKey: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----',
            },
          },
        },
        // Trailing slash on purpose: the callback must still be the registered Return URL.
        { provide: baseConfig.KEY, useValue: { publicOrigin: 'https://app.teable.test/' } },
        { provide: UserService, useValue: userService },
        { provide: OauthStoreService, useValue: {} },
      ],
    }).compile();
    strategy = module.get(AppleStrategy);
    userService.findOrCreateUser.mockResolvedValue(dbUser as never);
  });

  afterEach(() => {
    mockReset(userService);
  });

  const validate = (idToken: string, body?: Record<string, unknown>) =>
    strategy.validate(requestWith(body), 'access-token', 'refresh-token', idToken, {});

  it('signs the user in from the id_token and the first-login user field', async () => {
    const result = await validate(idTokenWith(), {
      user: JSON.stringify({ name: { firstName: 'Jane', lastName: 'Doe' }, email: EMAIL }),
    });

    expect(userService.findOrCreateUser).toHaveBeenCalledWith({
      name: 'Jane Doe',
      email: EMAIL,
      provider: 'apple',
      providerId: SUB,
      type: 'oauth',
    });
    expect(userService.refreshLastSignTime).toHaveBeenCalledWith('usrApple');
    expect(result).toMatchObject({ id: 'usrApple', email: EMAIL, hasPassword: false });
  });

  it('falls back to the email local part when Apple sends no name (every login after the first)', async () => {
    await validate(idTokenWith());

    expect(userService.findOrCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'jane', providerId: SUB })
    );
  });

  it.each([
    ['another client', { aud: 'com.other.app' }],
    ['another issuer', { iss: 'https://accounts.example.com' }],
  ])('rejects an id_token minted for %s', async (_label, claims) => {
    await expect(validate(idTokenWith(claims))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(userService.findOrCreateUser).not.toHaveBeenCalled();
  });

  it('signs a returning user in by subject when Apple sends no email', async () => {
    userService.getUserByAccount.mockResolvedValue(dbUser as never);

    const result = await validate(idTokenWith({ email: undefined }));

    expect(userService.getUserByAccount).toHaveBeenCalledWith('apple', SUB);
    expect(userService.findOrCreateUser).not.toHaveBeenCalled();
    expect(userService.refreshLastSignTime).toHaveBeenCalledWith('usrApple');
    expect(result).toMatchObject({ id: 'usrApple', email: EMAIL });
  });

  it('takes the email from the first-login user field when the id_token has none', async () => {
    await validate(idTokenWith({ email: undefined }), {
      user: JSON.stringify({ name: { firstName: 'Jane' }, email: EMAIL }),
    });

    expect(userService.findOrCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, name: 'Jane', providerId: SUB })
    );
    expect(userService.getUserByAccount).not.toHaveBeenCalled();
  });

  it('rejects an unknown subject when Apple sends no email', async () => {
    userService.getUserByAccount.mockResolvedValue(undefined as never);

    await expect(validate(idTokenWith({ email: undefined }))).rejects.toThrow(
      'No email provided from Apple'
    );
  });

  it('uses the subject binding when the token email is empty', async () => {
    userService.getUserByAccount.mockResolvedValue(dbUser as never);
    await expect(validate(idTokenWith({ email: '' }))).resolves.toMatchObject({ id: dbUser.id });
    expect(userService.getUserByAccount).toHaveBeenCalledWith('apple', SUB);
    expect(userService.findOrCreateUser).not.toHaveBeenCalled();
  });

  it('uses the first-login email when the token email is empty', async () => {
    await validate(idTokenWith({ email: '' }), { user: JSON.stringify({ email: EMAIL }) });
    expect(userService.findOrCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL })
    );
  });

  it('rejects an unknown subject with no email even if the user field is malformed', async () => {
    const req = requestWith({ user: '{invalid' });
    await expect(
      strategy.validate(req, 'access', 'refresh', idTokenWith({ email: undefined }), {})
    ).rejects.toMatchObject({ reason: 'missing_email_unlinked', status: 401 });
    expect(userService.findOrCreateUser).not.toHaveBeenCalled();
  });

  it.each([null, [], 'not-claims'])('rejects non-object token claims: %j', async (claims) => {
    const req = requestWith();
    await expect(
      strategy.validate(req, 'access', 'refresh', `header.${encode(claims)}.signature`, {})
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(userService.findOrCreateUser).not.toHaveBeenCalled();
  });

  it('rejects a malformed id_token', async () => {
    await expect(validate('not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a deactivated account', async () => {
    userService.findOrCreateUser.mockResolvedValue({
      ...dbUser,
      deactivatedTime: new Date(),
    } as never);

    await expect(validate(idTokenWith())).rejects.toMatchObject({
      reason: 'deactivated',
      status: 400,
    });
    expect(userService.refreshLastSignTime).not.toHaveBeenCalled();
  });

  it('leaves the state parameter to the OAuth state store', () => {
    // passport-apple's own authorizationParams injects a random state, which makes
    // passport-oauth2 skip OauthStoreService on the way out and fail on the way back.
    expect(strategy.authorizationParams()).toEqual({ response_mode: 'form_post' });
  });

  // passport-oauth2 dispatches on the arities of the state store and of the verify
  // callback; drive the real authenticate() to prove both hops wire up.
  describe('authenticate', () => {
    type IPassportActions = {
      redirect: (url: string) => void;
      success: (user: unknown, info: unknown) => void;
      fail: (info: unknown, status?: number) => void;
      error: (err: unknown) => void;
    };
    const oauthStore = {
      store: (_req: Request, done: (err: unknown, state: string) => void) =>
        done(null, 'state-from-store'),
      verify: (
        _req: Request,
        state: string,
        done: (err: unknown, ok: boolean, state: unknown) => void
      ) => done(null, state === 'state-from-store', { redirectUri: '/space' }),
    };

    const drive = (req: Record<string, unknown>) =>
      new Promise<{ kind: string; args: unknown[] }>((resolve, reject) => {
        const actions: IPassportActions = {
          redirect: (url) => resolve({ kind: 'redirect', args: [url] }),
          success: (user, info) => resolve({ kind: 'success', args: [user, info] }),
          fail: (info, status) => resolve({ kind: 'fail', args: [info, status] }),
          error: (err) => reject(err),
        };
        const live = Object.assign(Object.create(strategy), actions, { _stateStore: oauthStore });
        live.authenticate(req, {});
      });

    it('sends the browser to Apple with the stored state and form_post', async () => {
      const { kind, args } = await drive({ query: {}, body: {} });

      expect(kind).toBe('redirect');
      const url = new URL(args[0] as string);
      expect(`${url.origin}${url.pathname}`).toBe('https://appleid.apple.com/auth/authorize');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        client_id: CLIENT_ID,
        redirect_uri: 'https://app.teable.test/api/auth/apple/callback',
        response_type: 'code',
        response_mode: 'form_post',
        scope: 'name email',
        state: 'state-from-store',
      });
    });

    it('signs in from the form POST Apple sends back', async () => {
      const oauth2 = (strategy as unknown as { _oauth2: Record<string, unknown> })._oauth2;
      oauth2.getOAuthAccessToken = (
        code: string,
        _params: unknown,
        done: (err: unknown, at?: string, rt?: string, idToken?: string) => void
      ) => done(null, `at-for-${code}`, 'rt', idTokenWith());

      const { kind, args } = await drive({
        method: 'POST',
        query: {},
        body: {
          code: 'code-from-apple',
          state: 'state-from-store',
          user: JSON.stringify({ name: { firstName: 'Jane', lastName: 'Doe' } }),
        },
      });

      expect(kind).toBe('success');
      expect(args[0]).toMatchObject({ id: 'usrApple', email: EMAIL });
      expect(args[1]).toMatchObject({ state: { redirectUri: '/space' } });
      expect(userService.findOrCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Jane Doe', providerId: SUB })
      );
    });

    it('rejects a form POST whose state the store does not know', async () => {
      const { kind, args } = await drive({
        method: 'POST',
        query: {},
        body: { code: 'code-from-apple', state: 'forged' },
      });

      expect(kind).toBe('fail');
      expect(args[1]).toBe(403);
      expect(userService.findOrCreateUser).not.toHaveBeenCalled();
    });
  });
});

describe('Apple id_token helpers', () => {
  it('decodes the payload of an id_token', () => {
    expect(decodeAppleIdToken(idTokenWith({ is_private_email: 'true' }))).toMatchObject({
      sub: SUB,
      email: EMAIL,
      is_private_email: 'true',
    });
  });

  it('parses the first-login user field and ignores anything unparsable', () => {
    expect(parseAppleUserField(JSON.stringify({ name: { firstName: 'Jane' } }))).toEqual({
      name: { firstName: 'Jane' },
    });
    expect(parseAppleUserField('{oops')).toBeUndefined();
    expect(parseAppleUserField(undefined)).toBeUndefined();
  });

  it('derives the Return URL from the public origin', () => {
    expect(appleCallbackUrl('https://app.teable.ai')).toBe(
      'https://app.teable.ai/api/auth/apple/callback'
    );
    expect(appleCallbackUrl('https://staging.teable.ai/')).toBe(
      'https://staging.teable.ai/api/auth/apple/callback'
    );
  });

  it('builds the display name from whichever parts Apple sent', () => {
    expect(appleDisplayName({ name: { firstName: ' Jane ', lastName: '' } }, EMAIL)).toBe('Jane');
    expect(appleDisplayName({ name: { firstName: 'Jane', lastName: 'Doe' } }, EMAIL)).toBe(
      'Jane Doe'
    );
    expect(appleDisplayName(undefined, 'ann@example.com')).toBe('ann');
  });
});
