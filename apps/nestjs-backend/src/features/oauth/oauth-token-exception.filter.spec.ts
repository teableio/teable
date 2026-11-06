import {
  BadRequestException,
  HttpException,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { CustomHttpException } from '../../custom.exception';
import { OAuthTokenExceptionFilter } from './oauth-token-exception.filter';
import { OAuthTokenError, toOAuthTokenError } from './oauth-token.error';

describe('OAuthTokenError', () => {
  it.each([
    ['invalid_request', 400],
    ['invalid_client', 401],
    ['invalid_grant', 400],
    ['unauthorized_client', 400],
    ['unsupported_grant_type', 400],
    ['invalid_scope', 400],
    ['too_many_requests', 429],
    ['server_error', 500],
  ] as const)('%s is a %i by default', (code, status) => {
    const error = new OAuthTokenError(code, 'why');
    expect(error.getStatus()).toBe(status);
    expect(error.error).toBe(code);
    expect(error.message).toBe('why');
  });
});

describe('toOAuthTokenError', () => {
  it('keeps an OAuthTokenError as it is', () => {
    const error = new OAuthTokenError('invalid_grant', 'used', { retryAfter: 3 });
    expect(toOAuthTokenError(error)).toBe(error);
  });

  it('reads the client guard refusing the client as invalid_client', () => {
    const error = toOAuthTokenError(new UnauthorizedException('Client secret invalid'));
    expect(error.error).toBe('invalid_client');
    expect(error.getStatus()).toBe(401);
    expect(error.message).toBe('Client secret invalid');
  });

  it("gives passport's bare refusal a description of its own", () => {
    const error = toOAuthTokenError(new UnauthorizedException());
    expect(error.error).toBe('invalid_client');
    expect(error.message).toBe('Client authentication failed');
  });

  it('reads a 429 as too_many_requests', () => {
    const error = toOAuthTokenError(
      new CustomHttpException('slow down', HttpErrorCode.TOO_MANY_REQUESTS)
    );
    expect(error.error).toBe('too_many_requests');
    expect(error.getStatus()).toBe(429);
  });

  it('reads any other 4xx as invalid_request and a 5xx as server_error, keeping the status', () => {
    expect(toOAuthTokenError(new BadRequestException('bad body'))).toMatchObject({
      error: 'invalid_request',
      message: 'bad body',
    });
    expect(toOAuthTokenError(new HttpException('gone', 410)).getStatus()).toBe(410);
    const server = toOAuthTokenError(new InternalServerErrorException('boom'));
    expect(server.error).toBe('server_error');
    expect(server.getStatus()).toBe(500);
  });
});

describe('OAuthTokenExceptionFilter', () => {
  const filter = new OAuthTokenExceptionFilter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let res: any;
  const host = () =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: '/api/oauth/access_token' }),
        getResponse: () => res,
      }),
    }) as never;

  beforeEach(() => {
    res = { headersSent: false, setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the RFC 6749 §5.2 error object, uncached, and does not error-log a refusal', () => {
    filter.catch(new OAuthTokenError('invalid_grant', 'Refresh token has been revoked'), host());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_grant',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      error_description: 'Refresh token has been revoked',
    });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).not.toHaveBeenCalledWith('Retry-After', expect.anything());
    expect(Logger.prototype.error).not.toHaveBeenCalled();
  });

  it('puts the seconds left in the window on a 429 as Retry-After', () => {
    filter.catch(new OAuthTokenError('too_many_requests', 'later', { retryAfter: 587 }), host());

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '587');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'too_many_requests' }));
  });

  it("translates the guard's 401 for clients that parse OAuth errors", () => {
    filter.catch(new UnauthorizedException('Client not found'), host());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_client',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      error_description: 'Client not found',
    });
  });

  it('error-logs a 5xx, which is still a server fault', () => {
    filter.catch(new InternalServerErrorException('boom'), host());

    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'server_error' }));
  });

  it('writes nothing once the response has been sent', () => {
    res.headersSent = true;

    filter.catch(new OAuthTokenError('invalid_grant', 'late'), host());

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
