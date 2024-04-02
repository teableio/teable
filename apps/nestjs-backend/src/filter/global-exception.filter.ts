import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import {
  BadRequestException,
  Catch,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpErrorCode } from '@teable/core';
import type { Request, Response } from 'express';
import type { ILoggerConfig } from '../configs/logger.config';
import { CustomHttpException, getDefaultCodeByStatus } from '../custom.exception';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly configService: ConfigService) {}

  catch(exception: Error | HttpException, host: ArgumentsHost) {
    const { enableGlobalErrorLogging } = this.configService.getOrThrow<ILoggerConfig>('logger');

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (
      enableGlobalErrorLogging ||
      !(
        exception instanceof BadRequestException ||
        exception instanceof UnauthorizedException ||
        exception instanceof ForbiddenException ||
        exception instanceof NotFoundException ||
        exception instanceof NotImplementedException
      )
    )
      this.logError(exception, request);

    if (exception instanceof CustomHttpException) {
      const customException = exception as CustomHttpException;
      const status = customException.getStatus();
      return response.status(status).json({
        message: exception.message,
        status: status,
        code: customException.code,
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return response
        .status(status)
        .json({ message: exception.message, status, code: getDefaultCodeByStatus(status) });
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: exception.message || 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: HttpErrorCode.INTERNAL_SERVER_ERROR,
    });
  }

  protected logError(exception: Error, request: Request) {
    this.logger.error(
      {
        url: request?.url,
        message: exception.message,
      },
      exception.stack
    );
  }
}
