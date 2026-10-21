/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { SessionCsrfMiddleware } from './session-csrf.middleware';

const createRequest = (overrides: Partial<Request>): Request =>
  ({
    method: 'POST',
    path: '/api/table/tblxxx/view/viwxxx/refresh-share-id',
    originalUrl: '/api/table/tblxxx/view/viwxxx/refresh-share-id',
    protocol: 'http',
    headers: {
      host: '127.0.0.1:3000',
      cookie: 'auth_session=sid',
    },
    ...overrides,
  }) as Request;

const callMiddleware = (req: Request) => {
  const middleware = new SessionCsrfMiddleware(
    { publicOrigin: 'http://127.0.0.1:3000' } as never,
    {
      get: vi.fn().mockReturnValue({ sessionOriginCheck: { enabled: true } }),
    } as never
  );
  const next = vi.fn();
  middleware.use(req, {} as Response, next);
  return next;
};

const callDisabledMiddleware = (req: Request) => {
  const middleware = new SessionCsrfMiddleware(
    { publicOrigin: 'http://127.0.0.1:3000' } as never,
    {
      get: vi.fn().mockReturnValue({ sessionOriginCheck: { enabled: false } }),
    } as never
  );
  const next = vi.fn();
  middleware.use(req, {} as Response, next);
  return next;
};

describe('SessionCsrfMiddleware', () => {
  it('allows all requests when session origin check is disabled', () => {
    const next = callDisabledMiddleware(
      createRequest({
        headers: {
          host: '127.0.0.1:3000',
          cookie: 'auth_session=sid',
          origin: 'http://127.0.0.1:4173',
        },
      })
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects cross-site unsafe requests with session cookies', () => {
    const next = callMiddleware(
      createRequest({
        headers: {
          host: '127.0.0.1:3000',
          cookie: 'auth_session=sid',
          origin: 'http://127.0.0.1:4173',
        },
      })
    );

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });

  it('uses originalUrl when mounted middleware path is stripped', () => {
    const next = callMiddleware(
      createRequest({
        path: '/table/tblxxx/view/viwxxx/refresh-share-id',
        originalUrl: '/api/table/tblxxx/view/viwxxx/refresh-share-id',
        headers: {
          host: '127.0.0.1:3000',
          cookie: 'auth_session=sid',
          origin: 'http://127.0.0.1:4173',
        },
      })
    );

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });

  it('matches the API prefix the way Express routes it (case-insensitively)', () => {
    const next = callMiddleware(
      createRequest({
        path: '/API/table/tblxxx/view/viwxxx/refresh-share-id',
        originalUrl: '/API/table/tblxxx/view/viwxxx/refresh-share-id',
        headers: {
          host: '127.0.0.1:3000',
          cookie: 'auth_session=sid',
          origin: 'http://127.0.0.1:4173',
        },
      })
    );

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });

  it('rejects unsafe requests marked as cross-site by fetch metadata', () => {
    const next = callMiddleware(
      createRequest({
        headers: {
          host: '127.0.0.1:3000',
          cookie: 'auth_session=sid',
          'sec-fetch-site': 'cross-site',
        },
      })
    );

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });

  it('allows same-origin unsafe requests with session cookies', () => {
    const next = callMiddleware(
      createRequest({
        headers: {
          host: '127.0.0.1:3000',
          cookie: 'auth_session=sid',
          origin: 'http://127.0.0.1:3000',
        },
      })
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('allows bearer token requests', () => {
    const next = callMiddleware(
      createRequest({
        headers: {
          host: '127.0.0.1:3000',
          cookie: 'auth_session=sid',
          origin: 'http://evil.example',
          authorization: 'Bearer token',
        },
      })
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('allows requests without session cookies', () => {
    const next = callMiddleware(
      createRequest({
        headers: {
          host: '127.0.0.1:3000',
          origin: 'http://evil.example',
        },
      })
    );

    expect(next).toHaveBeenCalledWith();
  });

  describe('sign-in endpoints (login CSRF)', () => {
    const signinRequest = (originalUrl: string, headers: Record<string, string>) =>
      createRequest({
        path: originalUrl.split('?')[0],
        originalUrl,
        headers: { host: '127.0.0.1:3000', ...headers },
      });

    it.each([
      '/api/auth/signin',
      '/api/auth/signin-with-code',
      '/api/auth/signup',
      '/api/auth/signin/',
      '/API/Auth/SignIn?redirect=/space',
    ])('rejects a cross-site POST to %s even with the origin check off', (url) => {
      const next = callDisabledMiddleware(signinRequest(url, { 'sec-fetch-site': 'cross-site' }));

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
    });

    it.each(['same-origin', 'same-site', 'none'])(
      'allows a sign-in whose fetch metadata is %s',
      (site) => {
        const next = callDisabledMiddleware(
          signinRequest('/api/auth/signin', { 'sec-fetch-site': site })
        );

        expect(next).toHaveBeenCalledWith();
      }
    );

    it('allows a sign-in without fetch metadata (API clients, older browsers)', () => {
      const next = callDisabledMiddleware(
        signinRequest('/api/auth/signin', { origin: 'http://evil.example' })
      );

      expect(next).toHaveBeenCalledWith();
    });

    it('leaves other anonymous endpoints alone', () => {
      const next = callDisabledMiddleware(
        signinRequest('/api/auth/send-signin-verification-code', {
          'sec-fetch-site': 'cross-site',
        })
      );

      expect(next).toHaveBeenCalledWith();
    });

    it('checks the Origin of a sign-in without a session cookie when the origin check is on', () => {
      const next = callMiddleware(
        signinRequest('/api/auth/signin-with-code', { origin: 'http://evil.example' })
      );

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
    });

    it('allows a same-origin sign-in without a session cookie when the origin check is on', () => {
      const next = callMiddleware(
        signinRequest('/api/auth/signin', { origin: 'http://127.0.0.1:3000' })
      );

      expect(next).toHaveBeenCalledWith();
    });
  });

  it("lets Apple's cross-site form POST callback through", () => {
    const next = callMiddleware(
      createRequest({
        path: '/api/auth/apple/callback',
        originalUrl: '/api/auth/apple/callback?utm=1',
        headers: {
          host: '127.0.0.1:3000',
          cookie: 'auth_session=sid',
          origin: 'https://appleid.apple.com',
          'sec-fetch-site': 'cross-site',
        },
      })
    );

    expect(next).toHaveBeenCalledWith();
  });
});
