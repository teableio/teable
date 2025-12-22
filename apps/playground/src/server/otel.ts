import {
  context as otelContext,
  SpanStatusCode,
  trace,
  type Span as ApiSpan,
} from '@opentelemetry/api';
import { ORPCInstrumentation } from '@orpc/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import type { ISpan, ITracer, SpanAttributeValue, SpanAttributes } from '@teable/v2-core';

const parseOtelHeaders = (headerStr?: string) => {
  if (!headerStr) return {};
  return headerStr.split(',').reduce(
    (acc, curr) => {
      const [key, value] = curr.split('=');
      if (key && value) {
        acc[key.trim()] = value.trim();
      }
      return acc;
    },
    {} as Record<string, string>
  );
};

const serviceName = process.env.OTEL_SERVICE_NAME ?? 'teable-playground';
const serviceVersion = process.env.BUILD_VERSION;
const traceEndpoint =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const otelHeaders = parseOtelHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

const traceExporter = traceEndpoint
  ? new OTLPTraceExporter({
      url: traceEndpoint,
      headers: {
        'Content-Type': 'application/x-protobuf',
        ...otelHeaders,
      },
    })
  : undefined;

const resourceAttributes = {
  [ATTR_SERVICE_NAME]: serviceName,
  ...(serviceVersion ? { [ATTR_SERVICE_VERSION]: serviceVersion } : {}),
};

const globalAny = globalThis as typeof globalThis & {
  __teablePlaygroundOtelSdk?: NodeSDK;
};

export const ensureServerOtel = () => {
  if (globalAny.__teablePlaygroundOtelSdk) return globalAny.__teablePlaygroundOtelSdk;

  const sdkOptions = {
    resource: resourceFromAttributes(resourceAttributes),
    instrumentations: [
      new ORPCInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: true }),
    ],
  };

  const sdk = new NodeSDK(traceExporter ? { ...sdkOptions, traceExporter } : sdkOptions);

  Promise.resolve()
    .then(() => sdk.start())
    .catch((err) => console.error('Playground OTEL start error', err));
  globalAny.__teablePlaygroundOtelSdk = sdk;

  const shutdown = () =>
    sdk.shutdown().then(
      () => console.log('Playground OTEL shut down'),
      (err) => console.log('Playground OTEL shutdown error', err)
    );

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return sdk;
};

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

export const v2Tracer = new OpenTelemetryTracer('v2-core');

ensureServerOtel();
