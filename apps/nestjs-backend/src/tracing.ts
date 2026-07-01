/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
/**
 * OpenTelemetry Tracing Configuration
 *
 * This module initializes OpenTelemetry SDK for distributed tracing, logging, and metrics.
 *
 * Environment Variables:
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 * | Variable                           | Description                    | Dev Default      | Prod Default |
 * |------------------------------------|--------------------------------|------------------|--------------|
 * | OTEL_EXPORTER_OTLP_ENDPOINT        | Trace exporter endpoint        | localhost:4318   | (disabled)   |
 * | OTEL_EXPORTER_OTLP_LOGS_ENDPOINT   | Log exporter endpoint          | localhost:4318   | (disabled)   |
 * | OTEL_EXPORTER_OTLP_METRICS_ENDPOINT| Metrics exporter endpoint      | (disabled)       | (disabled)   |
 * | OTEL_EXPORTER_OTLP_HEADERS         | Custom headers (key=val,...)   | (none)           | (none)       |
 * | OTEL_SERVICE_NAME                  | Service name for tracing       | teable           | teable       |
 * | OTEL_EXPORT_RATIO                  | Export ratio (0.0-1.0)         | 1.0 (100%)       | 0.1 (10%)    |
 * | OTEL_EXPORT_LATENCY_THRESHOLD_MS   | Slow request threshold (ms)    | 1500             | 1500         |
 * | OTEL_BSP_MAX_QUEUE_SIZE            | Trace BSP max queue size       | 2048             | 2048         |
 * | OTEL_BSP_MAX_EXPORT_BATCH_SIZE     | Trace BSP max export batch     | 512              | 512          |
 * | OTEL_BSP_SCHEDULE_DELAY            | Trace BSP delay (ms)           | 5000             | 5000         |
 * | OTEL_BSP_EXPORT_TIMEOUT            | Trace BSP export timeout (ms)  | 30000            | 30000        |
 * | OTEL_METRIC_EXPORT_INTERVAL_MS     | Metrics export interval (ms)   | 10000            | 60000        |
 * | BACKEND_SENTRY_DSN                 | Sentry DSN for error tracking  | (disabled)       | (disabled)   |
 * | BUILD_VERSION                      | Build version for resource     | (none)           | (none)       |
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Notes:
 * - In development, traces and logs are enabled by default (localhost endpoint)
 * - In production, you must explicitly set OTEL_EXPORTER_OTLP_ENDPOINT to enable tracing
 * - Sampling rate is always 100%; OTEL_EXPORT_RATIO controls how many spans are sent to backend
 * - Smart export always sends: errors, HTTP 5xx responses, and slow requests (regardless of ratio)
 */
import { Logger } from '@nestjs/common';
import { metrics, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import * as opentelemetry from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  NoopSpanProcessor,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import {
  SentryPropagator,
  SentrySpanProcessor,
  wrapContextManagerClass,
} from '@sentry/opentelemetry';
import { setTeableDbSpanAttributes, setTeableDbSpanAttributesFromSpan } from './tracing-db-context';

// Use webpack's special require that bypasses bundling, falling back to standard require
// This is needed because webpack transforms import.meta.url and createRequire in ways
// that can break module resolution for native Node.js modules like pg.
declare const __non_webpack_require__: NodeRequire | undefined;
const nativeRequire: NodeRequire =
  typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require;

const { BatchLogRecordProcessor } = opentelemetry.logs;
const { PeriodicExportingMetricReader, AggregationType, createAllowListAttributesProcessor } =
  opentelemetry.metrics;
const { AlwaysOnSampler } = opentelemetry.node;

const otelLogger = new Logger('OpenTelemetry');
const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Environment-specific default values
 * - undefined means the feature is disabled unless explicitly configured
 */
const ENV_DEFAULTS = {
  development: {
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318/v1/traces',
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://localhost:4318/v1/logs',
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: undefined,
    OTEL_SERVICE_NAME: 'teable',
    OTEL_EXPORT_RATIO: '1.0',
    OTEL_EXPORT_LATENCY_THRESHOLD_MS: '1500',
    OTEL_BSP_MAX_QUEUE_SIZE: '2048',
    OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '512',
    OTEL_BSP_SCHEDULE_DELAY: '5000',
    OTEL_BSP_EXPORT_TIMEOUT: '30000',
    OTEL_METRIC_EXPORT_INTERVAL_MS: '10000',
  },
  production: {
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: undefined,
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: undefined,
    OTEL_SERVICE_NAME: 'teable',
    OTEL_EXPORT_RATIO: '0.1',
    OTEL_EXPORT_LATENCY_THRESHOLD_MS: '1500',
    OTEL_BSP_MAX_QUEUE_SIZE: '2048',
    OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '512',
    OTEL_BSP_SCHEDULE_DELAY: '5000',
    OTEL_BSP_EXPORT_TIMEOUT: '30000',
    OTEL_METRIC_EXPORT_INTERVAL_MS: '60000',
  },
} as const;

const hasSentry = !!process.env.BACKEND_SENTRY_DSN;

type EnvConfigKey = keyof typeof ENV_DEFAULTS.development;

/**
 * Get configuration value
 * Priority: environment variable > current environment default
 */
const getConfig = (key: EnvConfigKey): string | undefined => {
  const envValue = process.env[key];
  if (envValue !== undefined) return envValue;

  const defaults = isDevelopment ? ENV_DEFAULTS.development : ENV_DEFAULTS.production;
  return defaults[key];
};

const parseHeaders = (headerStr?: string): Record<string, string> => {
  if (!headerStr) return {};
  return headerStr.split(',').reduce(
    (acc, curr) => {
      const [key, ...valueParts] = curr.split('=');
      const value = valueParts.join('=');
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    },
    {} as Record<string, string>
  );
};

const parseNumber = (value: string | undefined, defaultValue: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const parseIntegerConfig = (key: EnvConfigKey, defaultValue: number, minValue: number): number => {
  const parsed = Math.floor(parseNumber(getConfig(key), defaultValue));
  return Math.max(minValue, parsed);
};

// Configuration
const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
const traceEndpoint = getConfig('OTEL_EXPORTER_OTLP_ENDPOINT');
const logEndpoint = getConfig('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT');
const metricsEndpoint = getConfig('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT');
const serviceName = getConfig('OTEL_SERVICE_NAME') || 'teable';
const exportRatio = Math.max(0, Math.min(1, parseNumber(getConfig('OTEL_EXPORT_RATIO'), 0.1)));
const latencyThresholdMs = Math.max(
  0,
  parseNumber(getConfig('OTEL_EXPORT_LATENCY_THRESHOLD_MS'), 1500)
);
const traceBatchMaxQueueSize = parseIntegerConfig('OTEL_BSP_MAX_QUEUE_SIZE', 2048, 1);
const traceBatchMaxExportBatchSize = Math.min(
  traceBatchMaxQueueSize,
  parseIntegerConfig('OTEL_BSP_MAX_EXPORT_BATCH_SIZE', 512, 1)
);
const traceBatchScheduledDelayMillis = parseIntegerConfig('OTEL_BSP_SCHEDULE_DELAY', 5000, 0);
const traceBatchExportTimeoutMillis = parseIntegerConfig('OTEL_BSP_EXPORT_TIMEOUT', 30000, 1);
const metricExportIntervalMs = Math.max(
  1000,
  parseNumber(getConfig('OTEL_METRIC_EXPORT_INTERVAL_MS'), 60000)
);
// Exporters
const createExporterOptions = (url?: string) => ({
  url,
  headers: { 'Content-Type': 'application/x-protobuf', ...headers },
});

const traceExporter = traceEndpoint
  ? new OTLPTraceExporter(createExporterOptions(traceEndpoint))
  : undefined;
const logExporter = logEndpoint
  ? new OTLPLogExporter(createExporterOptions(logEndpoint))
  : undefined;
const metricsExporter = metricsEndpoint
  ? new OTLPMetricExporter(createExporterOptions(metricsEndpoint))
  : undefined;

// Strip high-cardinality resource attributes from metrics only.
// Traces and logs keep these for debugging; metrics drop them to prevent
// cardinality explosion (each restart = new host.name + pid; each deploy =
// new service.version build tag, so the unique metric series count would grow
// unbounded over time as releases accumulate).
if (metricsExporter) {
  const dropFromMetricResource = new Set([
    'host.name',
    'host.arch',
    'os.type',
    'os.description',
    'process.pid',
    'process.command',
    'process.command_args',
    'process.command_line',
    'process.executable.path',
    'process.owner',
    'service.instance.id',
    'service.version',
  ]);
  const origExport = metricsExporter.export.bind(metricsExporter);
  metricsExporter.export = (metrics, cb) => {
    const attrs = Object.fromEntries(
      Object.entries(metrics.resource.attributes).filter(([k]) => !dropFromMetricResource.has(k))
    );
    origExport({ ...metrics, resource: resourceFromAttributes(attrs) }, cb);
  };
}

// Smart export: deterministic decision based on traceId hash
// No cache needed - hash function is pure and fast
const getTraceDecision = (traceId: string): boolean => {
  // FNV-1a hash for better distribution
  let hash = 2166136261;
  for (let i = 0; i < traceId.length; i++) {
    hash ^= traceId.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash % 10000 < exportRatio * 10000;
};

// Prisma emits ~11 spans per query (operation, client:middleware/serialize,
// engine:query/connection/db_query/serialize/...). Keep only the spine
// (operation -> engine:query -> db_query) and drop the rest. The full spine is kept
// so the surviving db_query is never orphaned (which renders as a "Missing Span").
const PRISMA_SPINE_SPANS = new Set([
  'prisma:client:operation',
  'prisma:engine:query',
  'prisma:engine:db_query',
]);

const isDroppedPrismaSpan = (span: opentelemetry.tracing.ReadableSpan): boolean =>
  span.name.startsWith('prisma:') && !PRISMA_SPINE_SPANS.has(span.name);

const isPriorityTraceSpan = (span: opentelemetry.tracing.ReadableSpan): boolean => {
  const attributes = span.attributes;
  return (
    span.kind === SpanKind.SERVER ||
    typeof attributes['teable.route.full'] === 'string' ||
    typeof attributes['http.route'] === 'string' ||
    (typeof attributes['nest.controller'] === 'string' &&
      typeof attributes['nest.handler'] === 'string')
  );
};

const shouldExportSpan = (span: opentelemetry.tracing.ReadableSpan): boolean => {
  // Always export errors
  if (span.status.code === SpanStatusCode.ERROR) return true;

  // Always export HTTP errors (5xx)
  const httpStatusCode = span.attributes[ATTR_HTTP_RESPONSE_STATUS_CODE];
  if (typeof httpStatusCode === 'number' && httpStatusCode >= 500) return true;

  // Always export slow requests
  const durationMs = span.duration[0] * 1000 + span.duration[1] / 1_000_000;
  if (durationMs > latencyThresholdMs) return true;

  if (isDroppedPrismaSpan(span)) return false;

  if (exportRatio >= 1.0) return true;

  // Consistent export decision based on traceId - all spans in same trace have same fate
  return getTraceDecision(span.spanContext().traceId);
};

const createSmartSpanProcessor = (
  batchExporter: OTLPTraceExporter,
  priorityExporter: OTLPTraceExporter
): SpanProcessor => {
  const batchProcessor = new BatchSpanProcessor(batchExporter, {
    maxQueueSize: traceBatchMaxQueueSize,
    maxExportBatchSize: traceBatchMaxExportBatchSize,
    scheduledDelayMillis: traceBatchScheduledDelayMillis,
    exportTimeoutMillis: traceBatchExportTimeoutMillis,
  });
  const priorityProcessor = new SimpleSpanProcessor(priorityExporter);

  return {
    onStart: (span, parentContext) => {
      priorityProcessor.onStart(span, parentContext);
      batchProcessor.onStart(span, parentContext);
    },
    onEnd: (span: opentelemetry.tracing.ReadableSpan) => {
      if (isPriorityTraceSpan(span)) {
        priorityProcessor.onEnd(span);
        return;
      }
      if (shouldExportSpan(span)) batchProcessor.onEnd(span);
    },
    shutdown: () =>
      Promise.all([priorityProcessor.shutdown(), batchProcessor.shutdown()]).then(() => undefined),
    forceFlush: () =>
      Promise.all([priorityProcessor.forceFlush(), batchProcessor.forceFlush()]).then(
        () => undefined
      ),
  };
};

// Track in-flight outbound HTTP requests by target host via SpanProcessor,
// since instrumentation-http only records duration after completion.
const httpClientActiveRequests = metrics
  .getMeter('teable-observability')
  .createUpDownCounter('http.client.active_requests', {
    description: 'Number of currently in-flight outbound HTTP requests',
  });

const httpClientActiveRequestsProcessor: SpanProcessor = {
  onStart(span): void {
    if (span.kind !== SpanKind.CLIENT) return;
    const host = String(
      span.attributes['server.address'] || span.attributes['net.peer.name'] || ''
    );
    if (host) {
      httpClientActiveRequests.add(1, { 'server.address': host });
    }
  },
  onEnd(span): void {
    if (span.kind !== SpanKind.CLIENT) return;
    const host = String(
      span.attributes['server.address'] || span.attributes['net.peer.name'] || ''
    );
    if (host) {
      httpClientActiveRequests.add(-1, { 'server.address': host });
    }
  },
  shutdown: () => Promise.resolve(),
  forceFlush: () => Promise.resolve(),
};

const teableDbSpanAttributeProcessor: SpanProcessor = {
  onStart(span): void {
    const attributes = (span as unknown as { attributes?: Record<string, unknown> }).attributes;
    const dbSystem = attributes?.['db.system'];
    if (dbSystem !== 'postgresql' && dbSystem !== 'postgres') {
      return;
    }

    setTeableDbSpanAttributesFromSpan(
      span as unknown as Parameters<typeof setTeableDbSpanAttributesFromSpan>[0]
    );
  },
  onEnd: () => undefined,
  shutdown: () => Promise.resolve(),
  forceFlush: () => Promise.resolve(),
};

// Span processors - NoopSpanProcessor ensures trace context is always generated
// even when no exporter is configured (needed for trace ID in logs)
const spanProcessors = [
  ...(hasSentry ? [new SentrySpanProcessor()] : []),
  ...(traceExporter
    ? [
        createSmartSpanProcessor(
          traceExporter,
          new OTLPTraceExporter(createExporterOptions(traceEndpoint))
        ),
      ]
    : [new NoopSpanProcessor()]),
  httpClientActiveRequestsProcessor,
  teableDbSpanAttributeProcessor,
];

// When Sentry is enabled, use SentryPropagator and SentryContextManager to ensure
// Sentry spans are properly correlated with OTEL traces and async context is preserved.
const SentryContextManager = hasSentry
  ? wrapContextManagerClass(AsyncLocalStorageContextManager)
  : undefined;

const ignorePaths = [
  '/favicon.ico',
  '/_next/',
  '/__nextjs',
  '/images/',
  '/.well-known/',
  '/health',
];

// ─────────────────────────────────────────────────────────────────────────────
// Metric views — control auto-instrumented metrics we can't change at source.
//
// SigNoz charges per metric sample.  Each histogram with N bucket boundaries
// generates (N + 4) time-series per unique label combination.
// With ~200 HTTP routes × 14 default buckets × pods → billions of samples/month.
// ─────────────────────────────────────────────────────────────────────────────
const drop = { type: AggregationType.DROP } as const;
const buckets = (boundaries: number[]) =>
  ({ type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries } }) as const;

const metricViews: opentelemetry.metrics.ViewOptions[] = [
  // Drop inbound HTTP metrics — 200+ routes cause cardinality explosion;
  // traces already provide per-request latency/status via SigNoz APM.
  { instrumentName: 'http.server.duration', aggregation: drop },
  { instrumentName: 'http.client.duration', aggregation: drop },
  { instrumentName: 'http.server.request.duration', aggregation: drop },

  // Outbound HTTP — keep but drop server.address to cap cardinality
  // (50+ webhook hosts and growing). Only method + status remain.
  // Boundaries are in seconds (instrumentation-http records seconds).
  {
    instrumentName: 'http.client.request.duration',
    aggregation: buckets([0.05, 0.25, 1, 5, 30]),
    attributesProcessors: [
      createAllowListAttributesProcessor(['http.request.method', 'http.response.status_code']),
    ],
  },

  // Reduce high-cardinality auto-instrumented histograms from 16 → 6 series per label set.
  // Boundaries are in seconds: 1ms=cached, 5ms=indexed, 25ms=scan, 100ms=slow, 1s=very-slow.
  // Keep only operation name + system; drop db.namespace, server.address/port, error.type.
  {
    instrumentName: 'db.client.operation.duration',
    aggregation: buckets([0.001, 0.005, 0.025, 0.1, 1]),
    attributesProcessors: [createAllowListAttributesProcessor(['db.operation.name', 'db.system'])],
  },
];

const otelSDK = new opentelemetry.NodeSDK({
  spanProcessors,
  logRecordProcessors: logExporter ? [new BatchLogRecordProcessor(logExporter)] : [],
  sampler: new AlwaysOnSampler(),
  contextManager: SentryContextManager ? new SentryContextManager() : undefined,
  textMapPropagator: hasSentry ? new SentryPropagator() : undefined,
  views: metricViews,
  metricReader: metricsExporter
    ? new PeriodicExportingMetricReader({
        exporter: metricsExporter,
        exportIntervalMillis: metricExportIntervalMs,
      })
    : undefined,
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) => ignorePaths.some((path) => req.url?.startsWith(path)),
    }),
    new ExpressInstrumentation({
      ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.REQUEST_HANDLER],
    }),
    new NestInstrumentation(),
    new PrismaInstrumentation(),
    new PgInstrumentation({
      enhancedDatabaseReporting: true, // Records SQL; ensure sensitive data is scrubbed.
      requireParentSpan: false, // Create spans even without parent, ensures v2 Kysely queries are traced
      requestHook: (span, queryInfo) => {
        setTeableDbSpanAttributes(span, queryInfo.connection);
      },
    }),
    new PinoInstrumentation(),
    new RuntimeNodeInstrumentation(),
    new IORedisInstrumentation({
      requireParentSpan: true,
    }),
  ],
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: process.env.BUILD_VERSION,
  }),
});

// Log configuration on startup
otelLogger.log(
  `Initialized: service=${serviceName}, env=${isDevelopment ? 'dev' : 'prod'}, ` +
    `exportRatio=${exportRatio * 100}%, latencyThreshold=${latencyThresholdMs}ms, ` +
    `exporters=[traces:${!!traceEndpoint}, logs:${!!logEndpoint}, metrics:${!!metricsEndpoint}], ` +
    `traceBatch=[queue:${traceBatchMaxQueueSize}, batch:${traceBatchMaxExportBatchSize}, ` +
    `delay:${traceBatchScheduledDelayMillis}ms, timeout:${traceBatchExportTimeoutMillis}ms], ` +
    `metricsInterval=${metricExportIntervalMs}ms, ` +
    `sentry=${hasSentry}`
);

export default otelSDK;

// This ensures instrumentation is applied BEFORE any instrumented modules (like pg) are loaded.
try {
  otelSDK.start();
  // Force load pg after SDK start to ensure it is instrumented.
  // OpenTelemetry instruments modules by patching their exports when they're first required.
  // If pg is loaded before SDK.start(), the instrumentation won't work.
  //
  // Use nativeRequire to bypass webpack bundling and ensure we're loading
  // the actual pg module from node_modules, not a bundled version.
  try {
    nativeRequire('pg');
  } catch {
    // pg might not be available, that's ok
  }

  // Also force load via ESM import to ensure ESM module cache is populated
  // This is important because v2 adapter uses `await import('pg')`
  void import('pg').catch(() => {
    // pg might not be available via ESM, that's ok
  });
} catch (err) {
  console.error('OTEL SDK start error:', err);
}

let isShuttingDown = false;
const shutdownHandler = () => {
  if (isShuttingDown) return Promise.resolve();
  isShuttingDown = true;
  return otelSDK.shutdown().then(
    () => otelLogger.log('Shutdown successfully'),
    (err) => otelLogger.error('Shutdown error', err)
  );
};

process.on('SIGTERM', shutdownHandler);
process.on('SIGINT', shutdownHandler);
