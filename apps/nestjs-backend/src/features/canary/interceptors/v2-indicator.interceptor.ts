/* eslint-disable @typescript-eslint/naming-convention */
import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  Logger,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { IClsStore } from '../../../types/cls';

export const X_TEABLE_V2_HEADER = 'x-teable-v2';
export const X_TEABLE_V2_REASON_HEADER = 'x-teable-v2-reason';
export const X_TEABLE_V2_FEATURE_HEADER = 'x-teable-v2-feature';

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

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const useV2 = this.cls.get('useV2');
    const v2Reason = this.cls.get('v2Reason');
    const v2Feature = this.cls.get('v2Feature');

    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest();

    // Add V2 indicator headers regardless of useV2 value
    // This allows clients to understand why V2 was or wasn't used
    response.setHeader(X_TEABLE_V2_HEADER, useV2 ? 'true' : 'false');
    if (v2Reason) {
      response.setHeader(X_TEABLE_V2_REASON_HEADER, v2Reason);
    }
    if (v2Feature) {
      response.setHeader(X_TEABLE_V2_FEATURE_HEADER, v2Feature);
    }

    // Add span attributes for tracing
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes({
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
