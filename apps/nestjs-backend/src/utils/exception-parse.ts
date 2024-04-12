import { HttpException } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { CustomHttpException, getDefaultCodeByStatus } from '../custom.exception';

export const exceptionParse = (
  exception: Error | HttpException | CustomHttpException
): CustomHttpException => {
  if (exception instanceof CustomHttpException) {
    return exception;
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return new CustomHttpException(exception.message, getDefaultCodeByStatus(status));
  }

  return new CustomHttpException('Internal Server Error', HttpErrorCode.INTERNAL_SERVER_ERROR);
};
