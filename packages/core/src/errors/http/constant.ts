import { HttpErrorCode } from './http-response.types';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ErrorCodeToStatusMap: Record<HttpErrorCode, number> = {
  [HttpErrorCode.VALIDATION_ERROR]: 400,
  [HttpErrorCode.INVALID_CAPTCHA]: 400,
  [HttpErrorCode.INVALID_CREDENTIALS]: 400,
  [HttpErrorCode.UNAUTHORIZED]: 401,
  [HttpErrorCode.UNAUTHORIZED_SHARE]: 401,
  [HttpErrorCode.PAYMENT_REQUIRED]: 402,
  [HttpErrorCode.RESTRICTED_RESOURCE]: 403,
  [HttpErrorCode.NOT_FOUND]: 404,
  [HttpErrorCode.REQUEST_TIMEOUT]: 408,
  [HttpErrorCode.CONFLICT]: 409,
  [HttpErrorCode.UNPROCESSABLE_ENTITY]: 422,
  [HttpErrorCode.FAILED_DEPENDENCY]: 424,
  [HttpErrorCode.USER_LIMIT_EXCEEDED]: 460,
  [HttpErrorCode.TOO_MANY_REQUESTS]: 429,
  [HttpErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE]: 503,
  [HttpErrorCode.GATEWAY_TIMEOUT]: 504,
  [HttpErrorCode.UNKNOWN_ERROR_CODE]: 500,
  [HttpErrorCode.VIEW_NOT_FOUND]: 404,
};
