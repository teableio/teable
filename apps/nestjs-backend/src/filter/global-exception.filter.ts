import type { ArgumentsHost, ExceptionFilter, HttpException } from '@nestjs/common';
import {
  BadRequestException,
  Catch,
  ForbiddenException,
  Inject,
  Logger,
  NotFoundException,
  NotImplementedException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { ILoggerConfig } from '../configs/logger.config';
import { TemplateAppTokenNotAllowedException } from '../custom.exception';
import type { IClsStore } from '../types/cls';
import { exceptionParse } from '../utils/exception-parse';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private logger = new Logger(GlobalExceptionFilter.name);

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(ClsService) private readonly cls?: ClsService<IClsStore>
  ) {}

  catch(exception: Error | HttpException, host: ArgumentsHost) {
    const { enableGlobalErrorLogging } = this.configService.getOrThrow<ILoggerConfig>('logger');

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    this.captureException(exception);

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

  private captureException(exception: Error | HttpException) {
    if (this.isExpectedError(exception)) return;

    Sentry.withScope((scope) => {
      this.setSentryContext(scope);
      Sentry.captureException(exception, {
        mechanism: { handled: false, type: 'auto.function.nestjs.exception_captured' },
      });
    });
  }

  private setSentryContext(scope: Sentry.Scope) {
    scope.setUser(null);
    if (!this.cls) return;

    try {
      const userId = this.cls.get('user.id');
      if (userId && userId !== 'aiRobot') {
        const email = this.cls.get('user.email');
        scope.setUser({ id: userId, email });
      }

      const spaceId = this.cls.get('spaceId');
      if (spaceId) {
        scope.setTag('space.id', spaceId);
      }
    } catch {
      // CLS may not be active (e.g., non-HTTP contexts)
    }
  }

  private isExpectedError(exception: unknown) {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      ('status' in exception || 'error' in exception)
    );
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
