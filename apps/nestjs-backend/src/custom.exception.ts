import { HttpException, HttpStatus } from '@nestjs/common';
import type { ICustomHttpExceptionData } from '@teable/core';
import { ErrorCodeToStatusMap, HttpErrorCode } from '@teable/core';

export class CustomHttpException extends HttpException {
  code: string;
  data?: ICustomHttpExceptionData;

  constructor(message: string, code: HttpErrorCode, data?: ICustomHttpExceptionData) {
    super(message, ErrorCodeToStatusMap[code]);
    this.code = code;
    this.data = data;
  }
}

export const getDefaultCodeByStatus = (status: HttpStatus) => {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return HttpErrorCode.VALIDATION_ERROR;
    case HttpStatus.UNAUTHORIZED:
      return HttpErrorCode.UNAUTHORIZED;
    case HttpStatus.PAYMENT_REQUIRED:
      return HttpErrorCode.PAYMENT_REQUIRED;
    case HttpStatus.FORBIDDEN:
      return HttpErrorCode.RESTRICTED_RESOURCE;
    case HttpStatus.NOT_FOUND:
      return HttpErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return HttpErrorCode.CONFLICT;
    case HttpStatus.INTERNAL_SERVER_ERROR:
      return HttpErrorCode.INTERNAL_SERVER_ERROR;
    case HttpStatus.SERVICE_UNAVAILABLE:
      return HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE;
    case HttpStatus.REQUEST_TIMEOUT:
      return HttpErrorCode.REQUEST_TIMEOUT;
    default:
      return HttpErrorCode.UNKNOWN_ERROR_CODE;
  }
};
