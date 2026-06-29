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
import {
  getV2Attribution,
  getV2AttributionSpanAttributes,
  setV2AttributionHeaders,
  setV2AttributionOnCurrentSentryScopes,
} from '../v2-attribution';
export {
  TEABLE_REQUEST_ATTRIBUTION,
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../v2-attribution';

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
    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest();

    // Stamp the guard decision before the handler runs so thrown requests keep attribution.
    this.annotateRequest(response);

    return next.handle().pipe(
      tap(() => {
        // Re-stamp after success to reflect any controller-level fallback.
        const attribution = this.annotateRequest(response);

        if (!attribution.useV2) {
          return;
        }

        // Log V2 usage for tracing
        this.logger.debug({
          message: 'V2 implementation used',
          method: request.method,
          path: request.path,
          tableId: request.params?.tableId,
          useV2: true,
          v2Reason: attribution.v2Reason,
          v2Feature: attribution.v2Feature,
        });
      })
    );
  }

  private annotateRequest(response: Response) {
    const attribution = getV2Attribution(this.cls);

    setV2AttributionHeaders(response, attribution);
    setV2AttributionOnCurrentSentryScopes(attribution);

    const span = trace.getActiveSpan();
    if (span) {
      const attributes = getV2AttributionSpanAttributes(attribution);
      if (Object.keys(attributes).length) {
        span.setAttributes(attributes);
      }
    }

    return attribution;
  }
}
