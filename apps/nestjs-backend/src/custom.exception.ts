import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCodeToStatusMap, HttpErrorCode } from '@teable/core';

export class CustomHttpException extends HttpException {
  code: string;

  constructor(message: string, code: HttpErrorCode) {
    super(message, ErrorCodeToStatusMap[code]);
    this.code = code;
  }
}

export const getDefaultCodeByStatus = (status: HttpStatus) => {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return HttpErrorCode.VALIDATION_ERROR;
    case HttpStatus.UNAUTHORIZED:
      return HttpErrorCode.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return HttpErrorCode.RESTRICTED_RESOURCE;
    case HttpStatus.NOT_FOUND:
      return HttpErrorCode.NOT_FOUND;
    case HttpStatus.INTERNAL_SERVER_ERROR:
      return HttpErrorCode.INTERNAL_SERVER_ERROR;
    case HttpStatus.SERVICE_UNAVAILABLE:
      return HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE;
    default:
      return HttpErrorCode.UNKNOWN_ERROR_CODE;
  }
};
