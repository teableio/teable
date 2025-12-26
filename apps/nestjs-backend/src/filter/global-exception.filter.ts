import type { ExceptionFilter, HttpException } from '@nestjs/common';
import {
  BadRequestException,
  Catch,
  ForbiddenException,
  Logger,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
  ArgumentsHost,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import type { Request, Response } from 'express';
import type { ILoggerConfig } from '../configs/logger.config';
import { TemplateAppTokenNotAllowedException } from '../custom.exception';
import { exceptionParse } from '../utils/exception-parse';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly configService: ConfigService) {}

  @SentryExceptionCaptured()
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
    ) {
      this.logError(exception, request);
    }
    if (exception instanceof TemplateAppTokenNotAllowedException) {
      return response.status(exception.getStatus()).json({
        message: exception.message,
      });
    }
    const customHttpException = exceptionParse(exception);
    const status = customHttpException.getStatus();
    return response.status(status).json({
      message: customHttpException.message,
      status: status,
      code: customHttpException.code,
      data: customHttpException.data,
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
