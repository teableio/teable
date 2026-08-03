import type { Span as ApiSpan } from '@opentelemetry/api';
import { SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';
import type { ISpan, ITracer, SpanAttributeValue, SpanAttributes } from '@teable/v2-core';

export const V2_CODE_OWNERSHIP_ATTRIBUTE = 'teable.code.ownership';
export const V2_CODE_PATH_ATTRIBUTE = 'teable.code.path';
export const V2_CODE_LAYER_ATTRIBUTE = 'teable.code.layer';

const V2_SPAN_ATTRIBUTES: SpanAttributes = {
  [V2_CODE_OWNERSHIP_ATTRIBUTE]: 'v2',
  [V2_CODE_PATH_ATTRIBUTE]: 'community/packages/v2',
  [V2_CODE_LAYER_ATTRIBUTE]: 'core',
};

class OpenTelemetrySpan implements ISpan {
  constructor(public readonly span: ApiSpan) {}

  setAttribute(key: string, value: SpanAttributeValue): void {
    this.span.setAttribute(key, value);
  }

  setAttributes(attributes: SpanAttributes): void {
    this.span.setAttributes(attributes);
  }

  recordError(message: string): void {
    this.span.recordException(message);
    this.span.setStatus({ code: SpanStatusCode.ERROR, message });
  }

  end(): void {
    this.span.end();
  }
}

export class OpenTelemetryTracer implements ITracer {
  constructor(private readonly name = 'v2-core') {}

  startSpan(name: string, attributes?: SpanAttributes): ISpan {
    const tracer = trace.getTracer(this.name);
    const span = tracer.startSpan(
      name,
      { attributes: { ...V2_SPAN_ATTRIBUTES, ...attributes } },
      otelContext.active()
    );
    return new OpenTelemetrySpan(span);
  }

  async withSpan<T>(span: ISpan, callback: () => Promise<T>): Promise<T> {
    if (span instanceof OpenTelemetrySpan) {
      return otelContext.with(trace.setSpan(otelContext.active(), span.span), callback);
    }
    return callback();
  }

  getActiveSpan(): ISpan | undefined {
    const span = trace.getActiveSpan();
    if (!span) return undefined;
    return new OpenTelemetrySpan(span);
  }
}
