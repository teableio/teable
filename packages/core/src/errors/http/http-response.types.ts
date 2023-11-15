/* eslint-disable @typescript-eslint/naming-convention */

export type IHttpError = {
  /** a human-readable explanation specific to this occurrence of the problem. */
  message: string;
  /** the HTTP status code applicable to this problem, expressed as a string value. */
  status: number;
  /** an application-specific error code, expressed as a string value. */
  code: string;
};

export enum HttpErrorCode {
  INVALID_JSON = 'invalid_json',
  INVALID_REQUEST_URL = 'invalid_request_url',
  INVALID_REQUEST = 'invalid_request',
  VALIDATION_ERROR = 'validation_error',
  MESSING_VERSION = 'missing_version',
  UNAUTHORIZED = 'unauthorized',
  UNAUTHORIZED_SHARE = 'unauthorized_share',
  RESTRICTED_RESOURCE = 'restricted_resource',
  NOT_FOUND = 'not_found',
  CONFLICT_ERROR = 'conflict_error',
  INTERNAL_SERVER_ERROR = 'internal_server_error',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  DATABASE_CONNECTION_UNAVAILABLE = 'database_connection_unavailable',
  GATEWAY_TIMEOUT = 'gateway_timeout',
}
