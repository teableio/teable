import type { ArgumentsHost, ExecutionContext, INestApplication } from '@nestjs/common';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../../../types/cls';
import { AppleGuard } from '../../guard/apple.guard';
import { SessionService } from '../../session/session.service';
import { AppleAuthExceptionFilter } from './apple-auth-exception.filter';
import { AppleAuthException } from './apple-auth.exception';
import { AppleController } from './apple.controller';

const mobileRedirect =
  '/auth/mobile?code_challenge=challenge&state=mobile-state&redirect_uri=teable%3A%2F%2Fauth%2Fcallback';

describe('Apple authentication error handling', () => {
  afterEach(() => vi.restoreAllMocks());

  const runFilter = (redirect?: string, exception: unknown = new UnauthorizedException()) => {
    const req = {
      body: { code: 'secret-code', user: 'secret-profile' },
      query: { redirect_uri: 'https://attacker.example' },
    } as unknown as Request;
    const res = { setHeader: vi.fn(), redirect: vi.fn() };
    const host = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ArgumentsHost;
    const cls = { get: vi.fn().mockReturnValue(redirect) } as unknown as ClsService<IClsStore>;
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    new AppleAuthExceptionFilter(cls).catch(exception, host);
    const url = new URL(res.redirect.mock.calls[0][1], 'https://staging.teable.test');
    return { res, url, warn, error };
  };

  it('redirects a failed POST without diagnostic metadata and preserves the mobile destination', () => {
    const { res, url, warn } = runFilter(
      mobileRedirect,
      new AppleAuthException('missing_email_unlinked')
    );
    expect(res.redirect).toHaveBeenCalledWith(303, expect.stringContaining('/auth/login?'));
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(url.searchParams.get('authError')).toBe('apple_email_unavailable');
    expect(url.searchParams.has('diagnosticId')).toBe(false);
    expect(url.searchParams.get('redirect')).toBe(mobileRedirect);
    expect(warn).toHaveBeenCalledWith({
      message: 'Apple sign-in failed',
      reason: 'missing_email_unlinked',
      status: 401,
      providerError: undefined,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('mobile-state');
  });

  it.each([undefined, 'https://attacker.example', '//attacker.example'])(
    'does not recover an untrusted redirect: %s',
    (redirect) => {
      const { url } = runFilter(redirect);
      expect(url.searchParams.has('redirect')).toBe(false);
      expect(url.searchParams.get('authError')).toBe('apple_signin_failed');
    }
  );

  it('keeps provider response bodies and exception messages out of logs and URLs', () => {
    const exception = Object.assign(new Error('secret-token-response'), {
      code: 'invalid_grant',
      data: 'secret-body',
    });
    const { error, url } = runFilter(undefined, exception);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ providerError: 'invalid_grant', status: 500 })
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-');
    expect(url.toString()).not.toContain('secret-');
  });

  it.each([
    ['deactivated', 'apple_account_unavailable'],
    ['invalid_state', 'apple_session_expired'],
  ] as const)('reports %s separately', (reason, authError) => {
    expect(
      runFilter(undefined, new AppleAuthException(reason)).url.searchParams.get('authError')
    ).toBe(authError);
  });

  it('extracts only an allowed code from a wrapped token endpoint failure', () => {
    const exception = Object.assign(new Error('Failed to obtain access token'), {
      oauthError: {
        data: JSON.stringify({ error: 'invalid_grant', error_description: 'secret-code' }),
      },
    });
    const { error } = runFilter(undefined, exception);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ providerError: 'invalid_grant' }));
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-code');
  });

  it('establishes the session and redirects without logging successful sign-ins', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const req = {
      body: {},
      user: { id: 'usrApple' },
      authInfo: { state: { redirectUri: mobileRedirect } },
      login: vi.fn((_user, done) => done(null)),
    } as unknown as Request;
    const res = { redirect: vi.fn() };
    const sessionService = { recordSignin: vi.fn(async () => undefined) };
    // SessionService is property-injected into the adapter by Nest.
    const controller = new AppleController();
    Object.assign(controller, { sessionService });
    await controller.appleCallback(req, res as never);
    expect(res.redirect).toHaveBeenCalledWith(mobileRedirect);
    expect(req.login).toHaveBeenCalledWith(req.user, expect.any(Function));
    expect(sessionService.recordSignin).toHaveBeenCalledWith(req, 'apple');
    expect(log).not.toHaveBeenCalled();

    log.mockClear();
    req.login = vi.fn((_user, done) => done(new Error('session unavailable'))) as typeof req.login;
    await expect(controller.appleCallback(req, res as never)).rejects.toThrow(
      'session unavailable'
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('classifies state validation failure without exposing the state', () => {
    const req = { body: {} } as Request;
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    expect(() =>
      new AppleGuard().handleRequest(
        null,
        false,
        'Invalid authorization request state',
        context,
        403
      )
    ).toThrow(new AppleAuthException('invalid_state'));
  });

  it('handles a real Nest guard failure before the Apple callback controller runs', async () => {
    let app: INestApplication | undefined;
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const module = await Test.createTestingModule({
        controllers: [AppleController],
        providers: [
          AppleAuthExceptionFilter,
          { provide: ClsService, useValue: { get: () => mobileRedirect } },
          { provide: SessionService, useValue: { recordSignin: vi.fn() } },
        ],
      })
        .overrideGuard(AppleGuard)
        .useValue({
          canActivate() {
            throw new AppleAuthException('missing_email_unlinked');
          },
        })
        .compile();
      app = module.createNestApplication({ logger: false });
      await app.listen(0, '127.0.0.1');
      const response = await fetch(`${await app.getUrl()}/api/auth/apple/callback`, {
        method: 'POST',
        redirect: 'manual',
      });
      expect(response.status).toBe(303);
      const location = new URL(response.headers.get('location')!, await app.getUrl());
      expect(location.pathname).toBe('/auth/login');
      expect(location.searchParams.get('authError')).toBe('apple_email_unavailable');
      expect(location.searchParams.get('redirect')).toBe(mobileRedirect);
      expect(location.searchParams.has('diagnosticId')).toBe(false);
      expect(await response.text()).not.toContain('No email provided from Apple');
    } finally {
      await app?.close();
    }
  });
});
