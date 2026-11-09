import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error codes the token endpoint answers with. All but one are RFC 6749 §5.2;
 * `too_many_requests` is the name the MCP TypeScript SDK gives a 429 from an
 * OAuth endpoint (the RFC has no code for rate limiting), so a client built on
 * it reads the refusal as "later", not as a reason to drop its tokens.
 */
export type IOAuthTokenErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'too_many_requests'
  | 'server_error';

const statusByCode: Record<IOAuthTokenErrorCode, number> = {
  invalid_request: HttpStatus.BAD_REQUEST,
  invalid_client: HttpStatus.UNAUTHORIZED,
  invalid_grant: HttpStatus.BAD_REQUEST,
  unauthorized_client: HttpStatus.BAD_REQUEST,
  unsupported_grant_type: HttpStatus.BAD_REQUEST,
  invalid_scope: HttpStatus.BAD_REQUEST,
  too_many_requests: HttpStatus.TOO_MANY_REQUESTS,
  server_error: HttpStatus.INTERNAL_SERVER_ERROR,
};

export const isOAuthTokenErrorCode = (code: unknown): code is IOAuthTokenErrorCode =>
  typeof code === 'string' && code in statusByCode;

/**
 * A token endpoint refusal in the terms OAuth clients act on. `error` is the
 * RFC 6749 §5.2 code: `invalid_grant` tells a client its refresh token (or
 * code) is dead and the person has to sign in again; `invalid_client` that its
 * credentials failed; `too_many_requests` to wait `retryAfter` seconds. The
 * deployment's `{message, status, code}` body said none of that, so an MCP
 * client answered 401 kept replaying the same dead refresh token once a second.
 */
export class OAuthTokenError extends HttpException {
  /** Seconds until the rate-limit window reopens; the `Retry-After` header. */
  readonly retryAfter?: number;

  constructor(
    readonly error: IOAuthTokenErrorCode,
    description: string,
    options: { status?: number; retryAfter?: number } = {}
  ) {
    super(description, options.status ?? statusByCode[error]);
    this.retryAfter = options.retryAfter;
  }
}

/**
 * The §5.2 reading of whatever reaches the token endpoint's filter. An
 * OAuthTokenError stands; a 401 is the client guard refusing the client's
 * credentials; a 429 the token rate limit; any other 4xx a malformed request and
 * a 5xx a server fault, each keeping its status.
 */
export function toOAuthTokenError(exception: HttpException): OAuthTokenError {
  if (exception instanceof OAuthTokenError) {
    return exception;
  }
  const status = exception.getStatus();
  if (status === HttpStatus.UNAUTHORIZED) {
    // Passport's bare refusal (neither client strategy accepted the request)
    // carries no message of its own.
    const message =
      exception.message === 'Unauthorized' ? 'Client authentication failed' : exception.message;
    return new OAuthTokenError('invalid_client', message);
  }
  if (status === HttpStatus.TOO_MANY_REQUESTS) {
    return new OAuthTokenError('too_many_requests', exception.message);
  }
  if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
    return new OAuthTokenError('server_error', exception.message, { status });
  }
  return new OAuthTokenError('invalid_request', exception.message, { status });
}
