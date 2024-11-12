import { HttpException } from '@nestjs/common';
import { HttpErrorCode, HttpError } from '@teable/core';
import { CustomHttpException, getDefaultCodeByStatus } from '../custom.exception';

export const exceptionParse = (
  exception: Error | HttpException | CustomHttpException | HttpError
): CustomHttpException => {
  if (exception instanceof HttpError) {
    return new CustomHttpException(exception.message, exception.code);
  }
  if (exception instanceof CustomHttpException) {
    return exception;
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return new CustomHttpException(exception.message, getDefaultCodeByStatus(status));
  }

  return new CustomHttpException(
    process.env.NODE_ENV === 'test'
      ? `Internal Server Error: ${exception.message}, ${exception.stack}`
      : 'Internal Server Error',
    HttpErrorCode.INTERNAL_SERVER_ERROR
  );
};
