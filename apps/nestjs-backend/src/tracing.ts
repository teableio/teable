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
import { BatchSpanProcessor, NoopSpanProcessor } from '@opentelemetry/sdk-trace-base';
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
const { PeriodicExportingMetricReader, AggregationType } = opentelemetry.metrics;
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
    OTEL_METRIC_EXPORT_INTERVAL_MS: '10000',
  },
  production: {
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: undefined,
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: undefined,
    OTEL_SERVICE_NAME: 'teable',
    OTEL_EXPORT_RATIO: '0.1',
    OTEL_EXPORT_LATENCY_THRESHOLD_MS: '1500',
    OTEL_METRIC_EXPORT_INTERVAL_MS: '60000',
  },
} as const;

const hasSentry = !!process.env.BACKEND_SENTRY_DSN;

type EnvConfigKey = keyof typeof ENV_DEFAULTS.development;
