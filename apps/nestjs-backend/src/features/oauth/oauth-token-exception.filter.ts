import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { toOAuthTokenError } from './oauth-token.error';

/**
 * Error responses of the token endpoint in the wire format OAuth clients parse
 * (RFC 6749 §5.2): `{error, error_description}`, and `Retry-After` on a 429.
 * Only HttpExceptions come here. A protocol refusal is the client's to act on,
 * not a server fault, so it is not error-logged; anything unexpected still
 * reaches the global filter as a 500, logged and captured there.
 */
@Catch(HttpException)
export class OAuthTokenExceptionFilter implements ExceptionFilter<HttpException> {
  private readonly logger = new Logger(OAuthTokenExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const error = toOAuthTokenError(exception);
    const status = error.getStatus();

    if (status >= 500) {
      this.logger.error(
        `[OAuth] ${req.method} ${req.url} -> ${status}: ${error.message}`,
        exception.stack
      );
    }
    // oauth2orize completes a successful response itself; nothing is left to write.
    if (res.headersSent) {
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    if (error.retryAfter !== undefined) {
      res.setHeader('Retry-After', String(error.retryAfter));
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    res.status(status).json({ error: error.error, error_description: error.message });
  }
}
