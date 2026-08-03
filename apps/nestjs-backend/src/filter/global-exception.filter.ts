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
import { metrics, trace, SpanStatusCode } from '@opentelemetry/api';
import * as Sentry from '@sentry/nestjs';
import { HttpErrorCode } from '@teable/core';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { ILoggerConfig } from '../configs/logger.config';
import { TemplateAppTokenNotAllowedException } from '../custom.exception';
import {
  getV2Attribution,
  getV2AttributionLogContext,
  getV2AttributionSpanAttributes,
  setV2AttributionHeaders,
  setV2AttributionOnSentryScope,
} from '../features/canary/v2-attribution';
import { classifyDataDbRuntimeError } from '../global/data-db-runtime-error';
import type { IDataDbRuntimeErrorClassification } from '../global/data-db-runtime-error';
import type { IClsStore } from '../types/cls';
import { exceptionParse } from '../utils/exception-parse';

const dataDbRuntimeErrorCounter = metrics
  .getMeter('teable-observability')
  .createCounter('teable.data_db.runtime_errors', {
    description: 'Runtime errors from an external data database bound to a space',
  });
const dataDbOtelAttribute = {
  mode: 'teable.data_db.mode',
  errorCode: 'teable.data_db.error_code',
  connectionId: 'teable.data_db.connection_id',
  urlFingerprint: 'teable.data_db.url_fingerprint',
  host: 'teable.data_db.host',
  database: 'teable.data_db.database',
  internalSchema: 'teable.data_db.internal_schema',
  retryable: 'teable.data_db.retryable',
  userActionable: 'teable.data_db.user_actionable',
} as const;

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
    const dataDbContext = this.getDataDbContext();
    const dataDbError = dataDbContext ? classifyDataDbRuntimeError(exception) : null;

    setV2AttributionHeaders(response, getV2Attribution(this.cls));
    this.annotateActiveSpan(dataDbError);
    this.recordDataDbMetric(dataDbError);
    this.captureException(exception, dataDbError);

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
    if (dataDbError) {
      return response.status(503).json({
        message:
          'The data database bound to this space is currently unavailable. Please check the external database connection and try again.',
        status: 503,
        code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
        data: {
          dataDb: {
            code: dataDbError.code,
            retryable: dataDbError.retryable,
            userActionable: dataDbError.userActionable,
            connectionId: dataDbContext?.connectionId,
            urlFingerprint: dataDbContext?.urlFingerprint,
            displayHost: dataDbContext?.displayHost,
            displayDatabase: dataDbContext?.displayDatabase,
            internalSchema: dataDbContext?.internalSchema,
          },
        },
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

  private captureException(
    exception: Error | HttpException,
    dataDbError?: IDataDbRuntimeErrorClassification | null
  ) {
    if (this.isExpectedError(exception)) return;

    Sentry.withScope((scope) => {
      this.setSentryContext(scope);
      this.setSentryDataDbContext(scope, dataDbError);
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
      setV2AttributionOnSentryScope(scope, getV2Attribution(this.cls));
    } catch {
      // CLS may not be active (e.g., non-HTTP contexts)
    }
  }

  private setSentryDataDbContext(
    scope: Sentry.Scope,
    dataDbError?: IDataDbRuntimeErrorClassification | null
  ) {
    const dataDbContext = this.getDataDbContext();
    if (!dataDbContext || !dataDbError) return;

    scope.setTag('data_db.mode', dataDbContext.mode);
    scope.setTag('data_db.error_code', dataDbError.code);
    scope.setTag('data_db.connection_id', dataDbContext.connectionId);
    scope.setTag('data_db.host', dataDbContext.displayHost ?? 'unknown');
    scope.setTag('data_db.database', dataDbContext.displayDatabase ?? 'unknown');
    scope.setTag('data_db.internal_schema', dataDbContext.internalSchema ?? 'unknown');
    scope.setContext('data_db', {
      ...dataDbContext,
      errorCode: dataDbError.code,
      driverCode: dataDbError.driverCode,
      retryable: dataDbError.retryable,
      userActionable: dataDbError.userActionable,
    });
  }

  private annotateActiveSpan(dataDbError?: IDataDbRuntimeErrorClassification | null) {
    const span = trace.getActiveSpan();
    if (!span) return;

    const v2Attributes = getV2AttributionSpanAttributes(getV2Attribution(this.cls));
    if (Object.keys(v2Attributes).length) {
      span.setAttributes(v2Attributes);
    }

    const dataDbContext = this.getDataDbContext();
    if (!dataDbContext || !dataDbError) return;

    span.setAttributes({
      [dataDbOtelAttribute.mode]: dataDbContext.mode,
      [dataDbOtelAttribute.errorCode]: dataDbError.code,
      [dataDbOtelAttribute.connectionId]: dataDbContext.connectionId,
      [dataDbOtelAttribute.urlFingerprint]: dataDbContext.urlFingerprint ?? '',
      [dataDbOtelAttribute.host]: dataDbContext.displayHost ?? '',
      [dataDbOtelAttribute.database]: dataDbContext.displayDatabase ?? '',
      [dataDbOtelAttribute.internalSchema]: dataDbContext.internalSchema ?? '',
      [dataDbOtelAttribute.retryable]: dataDbError.retryable,
      [dataDbOtelAttribute.userActionable]: dataDbError.userActionable,
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: dataDbError.code });
  }

  private recordDataDbMetric(dataDbError?: IDataDbRuntimeErrorClassification | null) {
    if (!dataDbError) return;

    dataDbRuntimeErrorCounter.add(1, {
      [dataDbOtelAttribute.errorCode]: dataDbError.code,
      [dataDbOtelAttribute.retryable]: dataDbError.retryable,
      [dataDbOtelAttribute.userActionable]: dataDbError.userActionable,
    });
  }

  private getDataDbContext() {
    try {
      return this.cls?.get('dataDb');
    } catch {
      return undefined;
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
    const dataDbContext = this.getDataDbContext();
    const dataDbError = dataDbContext ? classifyDataDbRuntimeError(exception) : null;
    const v2 = getV2AttributionLogContext(getV2Attribution(this.cls));
    this.logger.error(
      {
        url: request?.url,
        message: exception.message,
        v2,
        dataDb: dataDbError
          ? {
              code: dataDbError.code,
              connectionId: dataDbContext?.connectionId,
              urlFingerprint: dataDbContext?.urlFingerprint,
              displayHost: dataDbContext?.displayHost,
              displayDatabase: dataDbContext?.displayDatabase,
              internalSchema: dataDbContext?.internalSchema,
            }
          : undefined,
      },
      exception.stack
    );
  }
}
