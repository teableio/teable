import type { Span as ApiSpan } from '@opentelemetry/api';
import { SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';
import type {
  ISpan,
  ITracer,
  SpanAttributeValue,
  SpanAttributes,
} from '@teable/v2-core' with { 'resolution-mode': 'import' };

class OpenTelemetrySpan implements ISpan {
  constructor(private readonly span: ApiSpan) {}

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
    const span = tracer.startSpan(name, { attributes }, otelContext.active());
    return new OpenTelemetrySpan(span);
  }
}
