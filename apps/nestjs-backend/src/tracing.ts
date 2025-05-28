/* eslint-disable @typescript-eslint/naming-convention */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import * as opentelemetry from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';

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

const headers = parseOtelHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

const exporterOptions = {
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  headers: {
    'Content-Type': 'application/x-protobuf',
    ...headers,
  },
};

const { ParentBasedSampler, TraceIdRatioBasedSampler } = opentelemetry.node;

const traceExporter = exporterOptions.url ? new OTLPTraceExporter(exporterOptions) : undefined;

const otelSDK = new opentelemetry.NodeSDK({
  traceExporter,
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(Number(process.env.OTEL_SAMPLER_RATIO) || 0.1),
  }),
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request) => {
        const ignorePaths = [
          '/favicon.ico',
          '/_next/',
          '/__nextjs',
          '/images/',
          '/.well-known/',
          '/health',
        ];
        return ignorePaths.some((path) => request.url?.startsWith(path));
      },
    }),
    new PrismaInstrumentation({ middleware: false }),
  ],
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'teable',
    [ATTR_SERVICE_VERSION]: process.env.BUILD_VERSION,
  }),
});

export default otelSDK;

const shutdownHandler = () => {
  return otelSDK.shutdown().then(
    () => console.log('OTEL shut down successfully'),
    (err) => console.log('Error shutting down OTEL', err)
  );
};

// Handle both SIGTERM and SIGINT
process.on('SIGTERM', shutdownHandler);
process.on('SIGINT', shutdownHandler);
