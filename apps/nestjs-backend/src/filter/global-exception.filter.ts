import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { BadRequestException, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { IJsonApiError } from '@teable-group/core';
import type { Response } from 'express';
import { AjvError } from '../utils/catch-error';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private logger = new Logger(GlobalExceptionFilter.name);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    this.logger.error((exception as Error).message, (exception as Error).stack);

    if (exception instanceof BadRequestException || exception.getStatus?.() === 400) {
      const { error, message } = exception.getResponse();
      return response.status(400).json({ title: error, errors: message } as IJsonApiError);
    } else if (exception instanceof AjvError) {
      return response
        .status(400)
        .json({ title: exception.message, errors: exception.errors } as IJsonApiError);
    } else if (exception instanceof HttpException) {
      return response
        .status(exception.getStatus())
        .json({ title: exception.message } as IJsonApiError);
    }

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ title: 'Internal Server Error' } as IJsonApiError);
  }
}
