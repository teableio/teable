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
});
