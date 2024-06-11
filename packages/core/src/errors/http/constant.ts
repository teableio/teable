import { HttpErrorCode } from './http-response.types';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ErrorCodeToStatusMap: Record<HttpErrorCode, number> = {
  [HttpErrorCode.VALIDATION_ERROR]: 400,
  [HttpErrorCode.UNAUTHORIZED]: 401,
  [HttpErrorCode.UNAUTHORIZED_SHARE]: 401,
  [HttpErrorCode.RESTRICTED_RESOURCE]: 403,
  [HttpErrorCode.NOT_FOUND]: 404,
  [HttpErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE]: 503,
  [HttpErrorCode.GATEWAY_TIMEOUT]: 504,
  [HttpErrorCode.UNKNOWN_ERROR_CODE]: 500,
};
