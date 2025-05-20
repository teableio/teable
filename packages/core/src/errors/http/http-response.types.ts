/* eslint-disable @typescript-eslint/naming-convention */

export type IHttpError = {
  /** a human-readable explanation specific to this occurrence of the problem. */
  message: string;
  /** the HTTP status code applicable to this problem, expressed as a string value. */
  status: number;
  /** an application-specific error code, expressed as a string value. */
  code: string;
  /** additional data */
  data?: unknown;
};

export enum HttpErrorCode {
  // 400 - The request body does not match the schema for the expected parameters
  VALIDATION_ERROR = 'validation_error',
  // 400 - The captcha is invalid.
  INVALID_CAPTCHA = 'invalid_captcha',
  // 400 - The credentials are invalid.
  INVALID_CREDENTIALS = 'invalid_credentials',
  // 401 - The bearer token is not valid.
  UNAUTHORIZED = 'unauthorized',
  // 401 - Given the bearer token used, the client doesn't have permission to perform this operation.
  UNAUTHORIZED_SHARE = 'unauthorized_share',
  // 402 - Payment Required
  PAYMENT_REQUIRED = 'payment_required',
  // 403 - Given the bearer token used, the client doesn't have permission to perform this operation.
  RESTRICTED_RESOURCE = 'restricted_resource',
  // 404 - Given the bearer token used, the resource does not exist. This error can also indicate that the resource has not been shared with owner of the bearer token.
  NOT_FOUND = 'not_found',
  // 408 - Requset timeout
  REQUEST_TIMEOUT = 'request_timeout',
  // 409 - The request could not be completed due to a conflict with the current state of the resource.
  CONFLICT = 'conflict',
  // 422 - The request body does not match the schema for the expected parameters
  UNPROCESSABLE_ENTITY = 'unprocessable_entity',
  // 424 - The request failed because it depended on another request and that request failed.
  FAILED_DEPENDENCY = 'failed_dependency',
  // 460 - The user has reached the limit of the number of users that can be created in the current instance.
  USER_LIMIT_EXCEEDED = 'user_limit_exceeded',
  // 429 - The user has reached the limit of the number of requests that can be made in the current instance.
  TOO_MANY_REQUESTS = 'too_many_requests',
  // 500 - An unexpected error occurred.
  INTERNAL_SERVER_ERROR = 'internal_server_error',
  // 503 - database is unavailable or is not in a state that can be queried. Please try again later.
  DATABASE_CONNECTION_UNAVAILABLE = 'database_connection_unavailable',
  // 504 - The server, while acting as a gateway or proxy, did not receive a timely response from the upstream server it needed to access in order to complete the request.
  GATEWAY_TIMEOUT = 'gateway_timeout',
  // Unknown error code
  UNKNOWN_ERROR_CODE = 'unknown_error_code',
  /** view */
  VIEW_NOT_FOUND = 'view_not_found',
}

export type ICustomHttpExceptionLocalization<T = string> = {
  i18nKey: T;
  context?: Record<string, unknown>;
};

export type ICustomHttpExceptionData<T = string> = Record<string, unknown> & {
  localization?: ICustomHttpExceptionLocalization<T>;
};
