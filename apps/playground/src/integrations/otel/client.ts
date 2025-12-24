import { ORPCInstrumentation } from '@orpc/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let started = false;

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

export const initClientOtel = () => {
  if (started) return;
  started = true;

  const serviceName = import.meta.env.VITE_OTEL_SERVICE_NAME ?? 'teable-playground-web';
  const serviceVersion = import.meta.env.VITE_BUILD_VERSION;
  const otlpEndpoint = import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT;
  const otlpHeaders = parseOtelHeaders(import.meta.env.VITE_OTEL_EXPORTER_OTLP_HEADERS);

  const spanProcessors: SpanProcessor[] = [];

  if (otlpEndpoint) {
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: otlpEndpoint,
          headers: {
            'Content-Type': 'application/x-protobuf',
            ...otlpHeaders,
          },
        })
      )
    );
  } else if (import.meta.env.DEV) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      ...(serviceVersion ? { [ATTR_SERVICE_VERSION]: serviceVersion } : {}),
    }),
    spanProcessors,
  });

  provider.register();

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const corsUrls = [new RegExp(`^${escapeRegExp(window.location.origin)}`)];

  registerInstrumentations({
    instrumentations: [
      new ORPCInstrumentation(),
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: corsUrls,
      }),
    ],
  });
};
