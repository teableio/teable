import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
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
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Content-Type': 'application/x-protobuf',
    ...headers,
  },
};

const traceExporter = exporterOptions.url ? new OTLPTraceExporter(exporterOptions) : undefined;
const otelSDK = new opentelemetry.NodeSDK({
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      '@opentelemetry/instrumentation-http': {
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
      },
    }),
    new PrismaInstrumentation(),
  ],
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'teable',
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
