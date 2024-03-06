import * as os from 'os';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
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
  // traceExporter: new OTLPTraceExporter({
  //   url: 'http://localhost:4318/v1/traces',
  // }),
  contextManager: new AsyncLocalStorageContextManager(),
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new PrismaInstrumentation(),
    new PinoInstrumentation(),
  ],
  resource: new Resource({
    [SEMRESATTRS_HOST_NAME]: os.hostname(),
    [SEMRESATTRS_SERVICE_NAME]: 'teable',
    [SEMRESATTRS_SERVICE_VERSION]: 'v1.0.0',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  }),
});

export default otelSDK;

process.on('SIGTERM', () => {
  otelSDK
    .shutdown()
    .then(
      () => console.log('SDK shut down successfully'),
      (err) => console.log('Error shutting down SDK', err)
    )
    .finally(() => process.exit(0));
});
