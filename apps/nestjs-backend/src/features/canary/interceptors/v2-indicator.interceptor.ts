/* eslint-disable @typescript-eslint/naming-convention */
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { trace } from '@opentelemetry/api';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { IClsStore } from '../../../types/cls';

export const X_TEABLE_V2_HEADER = 'x-teable-v2';
export const X_TEABLE_V2_REASON_HEADER = 'x-teable-v2-reason';
export const X_TEABLE_V2_FEATURE_HEADER = 'x-teable-v2-feature';
export const TEABLE_REQUEST_ATTRIBUTION = 'teable.request.attribution';

type SentryScopeLike = {
  setTag(key: string, value: string): void;
};

const getSentryScopes = (): SentryScopeLike[] => {
  const sentryApi = Sentry as unknown as {
    getCurrentScope?: () => SentryScopeLike | undefined;
    getIsolationScope?: () => SentryScopeLike | undefined;
    getCurrentHub?: () => { getScope?: () => SentryScopeLike | undefined };
  };

  const scopes = [
    sentryApi.getCurrentScope?.(),
    sentryApi.getIsolationScope?.(),
    sentryApi.getCurrentHub?.()?.getScope?.(),
  ].filter((scope): scope is SentryScopeLike => Boolean(scope));

  return [...new Set(scopes)];
};

const setSentryTag = (key: string, value: string | undefined) => {
  if (value == null) {
    return;
  }

  for (const scope of getSentryScopes()) {
    scope.setTag(key, value);
  }
};

/**
 * Interceptor that adds V2 indicator to response headers and logs.
 * When a request uses V2 implementation (determined by V2FeatureGuard),
 * this interceptor adds:
 * - Response header: x-teable-v2: true
 * - Response header: x-teable-v2-reason: <reason>
 * - Response header: x-teable-v2-feature: <feature>
 * - Log entry with V2 indicator for tracing
 * - Span attributes for OpenTelemetry tracing
 */
@Injectable()
export class V2IndicatorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(V2IndicatorInterceptor.name);

  constructor(private readonly cls: ClsService<IClsStore>) {}

  private setHeaderIfPossible(response: Response, name: string, value: string) {
    if (response.headersSent || response.writableEnded || response.destroyed) {
      return;
    }

    response.setHeader(name, value);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const useV2 = this.cls.get('useV2');
    const v2Reason = this.cls.get('v2Reason');
    const v2Feature = this.cls.get('v2Feature');

    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest();

    // Add V2 indicator headers regardless of useV2 value
    // This allows clients to understand why V2 was or wasn't used
    this.setHeaderIfPossible(response, X_TEABLE_V2_HEADER, useV2 ? 'true' : 'false');
    if (v2Reason) {
      this.setHeaderIfPossible(response, X_TEABLE_V2_REASON_HEADER, v2Reason);
    }
    if (v2Feature) {
      this.setHeaderIfPossible(response, X_TEABLE_V2_FEATURE_HEADER, v2Feature);
    }

    // Mirror V2 indicators into Sentry tags so issue search can distinguish v1/v2 requests.
    setSentryTag('teable.version', useV2 ? 'v2' : 'v1');
    setSentryTag('teable.v2.enabled', useV2 ? 'true' : 'false');
    setSentryTag('teable.v2.reason', v2Reason);
    setSentryTag('teable.v2.feature', v2Feature);
    setSentryTag(TEABLE_REQUEST_ATTRIBUTION, useV2 ? 'v2' : 'v1');

    // Add span attributes for tracing
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes({
        [TEABLE_REQUEST_ATTRIBUTION]: useV2 ? 'v2' : 'v1',
        'teable.v2.enabled': useV2 ?? false,
        ...(v2Reason && { 'teable.v2.reason': v2Reason }),
        ...(v2Feature && { 'teable.v2.feature': v2Feature }),
      });
    }

    if (!useV2) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        // Log V2 usage for tracing
        this.logger.debug({
          message: 'V2 implementation used',
          method: request.method,
          path: request.path,
          tableId: request.params?.tableId,
          useV2: true,
          v2Reason,
          v2Feature,
        });
      })
    );
  }
}
