import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../../types/cls';
import { isValidRedirectPath } from '../../utils';
import { AppleAuthException } from './apple-auth.exception';

const providerErrorCode = (exception: unknown): string | undefined => {
  if (!exception || typeof exception !== 'object') return;
  let code = 'code' in exception ? exception.code : undefined;
  // passport-oauth2 wraps token endpoint failures in InternalOAuthError.
  const oauthError = 'oauthError' in exception ? exception.oauthError : undefined;
  if (oauthError && typeof oauthError === 'object' && 'data' in oauthError) {
    const data = oauthError.data;
    if (typeof data === 'string' && data.length <= 4096) {
      try {
        code = JSON.parse(data)?.error ?? code;
      } catch {
        // Non-JSON upstream errors are intentionally excluded from the log.
      }
    }
  }
  return typeof code === 'string' &&
    ['invalid_grant', 'invalid_client', 'invalid_request', 'access_denied'].includes(code)
    ? code
    : undefined;
};

@Catch()
export class AppleAuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppleAuthExceptionFilter.name);

  constructor(private readonly cls: ClsService<IClsStore>) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    // Provider errors can contain tokens, authorization codes or raw HTTP responses.
    // Log only status and allowlisted error codes, never the exception/request itself.
    const entry = {
      message: 'Apple sign-in failed',
      reason: exception instanceof AppleAuthException ? exception.reason : undefined,
      status,
      providerError: providerErrorCode(exception),
    };
    if (status >= 500) this.logger.error(entry);
    else this.logger.warn(entry);

    const query = new URLSearchParams({
      authError:
        exception instanceof AppleAuthException ? exception.authError : 'apple_signin_failed',
    });
    // This comes only from verified OAuth state, including the mobile PKCE destination.
    const redirect = this.cls.get('oauthRedirectUri');
    if (typeof redirect === 'string' && isValidRedirectPath(redirect)) {
      query.set('redirect', redirect);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(303, `/auth/login?${query.toString()}`);
  }
}
