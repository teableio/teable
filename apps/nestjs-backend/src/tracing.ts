/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
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

const isDevelopment = process.env.NODE_ENV !== 'production';

// Development fallbacks so local tracing/logging works without manual env setup.
const devOtelDefaults = {
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318/v1/traces',
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://localhost:4318/v1/logs',
  OTEL_TRACES_SAMPLER: 'always_on',
  OTEL_SERVICE_NAME: 'teable',
  OTEL_SAMPLER_RATIO: '1.0',
} as const;

type DevOtelKey = keyof typeof devOtelDefaults;

const resolveDevDefault = (key: DevOtelKey) => {
  return process.env[key] ?? (isDevelopment ? devOtelDefaults[key] : undefined);
};

const traceEndpoint = resolveDevDefault('OTEL_EXPORTER_OTLP_ENDPOINT');
const logEndpoint = resolveDevDefault('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT');
const samplerRatioEnv = resolveDevDefault('OTEL_SAMPLER_RATIO');
const traceSamplerSetting = resolveDevDefault('OTEL_TRACES_SAMPLER');
const serviceName = resolveDevDefault('OTEL_SERVICE_NAME') || 'teable';

const traceExporterOptions = {
  url: traceEndpoint,
  headers: {
    'Content-Type': 'application/x-protobuf',
    ...headers,
  },
};

const traceExporter = traceExporterOptions.url
  ? new OTLPTraceExporter(traceExporterOptions)
  : undefined;

const logExporterOptions = {
  url: logEndpoint,
  headers: {
    'Content-Type': 'application/x-protobuf',
    ...headers,
  },
};

const logExporter = logExporterOptions.url ? new OTLPLogExporter(logExporterOptions) : undefined;

const metricsExporterOptions = {
  url: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
  headers: {
    'Content-Type': 'application/x-protobuf',
    ...headers,
  },
};
const metricsExporter = metricsExporterOptions.url
  ? new OTLPMetricExporter(metricsExporterOptions)
  : undefined;

const { BatchLogRecordProcessor } = opentelemetry.logs;
const { PeriodicExportingMetricReader } = opentelemetry.metrics;
const { AlwaysOnSampler, ParentBasedSampler, TraceIdRatioBasedSampler } = opentelemetry.node;
const parsedSamplerRatio = Number(samplerRatioEnv);
const samplerRatio = Number.isFinite(parsedSamplerRatio) ? parsedSamplerRatio : 0.1;
const resolvedTraceSampler = traceSamplerSetting?.toLowerCase();
const sampler =
  resolvedTraceSampler === 'always_on'
    ? new AlwaysOnSampler()
    : new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(samplerRatio),
      });
const otelSDK = new opentelemetry.NodeSDK({
  traceExporter,
  logRecordProcessors: logExporter ? [new BatchLogRecordProcessor(logExporter)] : [],
  sampler,
  metricReader: metricsExporter
    ? new PeriodicExportingMetricReader({
        exporter: metricsExporter,
      })
    : undefined,
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
    new ExpressInstrumentation({
      ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.REQUEST_HANDLER],
    }),
    new NestInstrumentation(),
    new PrismaInstrumentation(),
    new PinoInstrumentation(),
  ],
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
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
