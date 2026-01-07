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
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

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
  __teablePlaygroundOtelStart?: Promise<NodeSDK>;
};

export const ensureServerOtel = async (): Promise<NodeSDK> => {
  if (globalAny.__teablePlaygroundOtelStart) return globalAny.__teablePlaygroundOtelStart;
  if (globalAny.__teablePlaygroundOtelSdk) {
    return Promise.resolve(globalAny.__teablePlaygroundOtelSdk);
  }

  const sdkOptions = {
    resource: resourceFromAttributes(resourceAttributes),
    instrumentations: [
      new ORPCInstrumentation(),
      new PgInstrumentation({
        enhancedDatabaseReporting: true,
        requireParentSpan: false,
      }),
    ],
  };

  const sdk = new NodeSDK(traceExporter ? { ...sdkOptions, traceExporter } : sdkOptions);

  globalAny.__teablePlaygroundOtelSdk = sdk;
  try {
    sdk.start();
  } catch (err) {
    console.error('Playground OTEL start error', err);
  }
  const startPromise = Promise.resolve(sdk);
  globalAny.__teablePlaygroundOtelStart = startPromise;

  const shutdown = () =>
    sdk.shutdown().then(
      () => console.log('Playground OTEL shut down'),
      (err) => console.log('Playground OTEL shutdown error', err)
    );

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    // Force load pg after SDK start to ensure it is instrumented.
    // In Nitro/Vite dev environments, this helps ensure the patch is applied before the app uses it.
    const adapterRequire = createRequire(require.resolve('@teable/v2-adapter-db-postgres-pg'));
    adapterRequire('pg');
  } catch {
    try {
      require('pg');
    } catch {
      // Ignore if pg is not available in the current environment
    }
  }

  return globalAny.__teablePlaygroundOtelStart;
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
    const span = tracer.startSpan(name, { attributes }, otelContext.active());
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
    return span ? new OpenTelemetrySpan(span) : undefined;
  }
}

export const v2Tracer = new OpenTelemetryTracer('v2-core');

void ensureServerOtel();
