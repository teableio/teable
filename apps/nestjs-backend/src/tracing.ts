import * as os from 'os';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  SEMRESATTRS_HOST_NAME,
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';

const otelSDK = new NodeSDK({
  traceExporter: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/x-protobuf',
        },
        timeoutMillis: 15000,
      })
    : undefined,
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new PrismaInstrumentation(),
    new PinoInstrumentation(),
  ],
  resource: new Resource({
    [SEMRESATTRS_HOST_NAME]: os.hostname(),
    [SEMRESATTRS_SERVICE_NAME]: 'teable',
    [SEMRESATTRS_SERVICE_VERSION]: process.env.BUILD_VERSION,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
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
