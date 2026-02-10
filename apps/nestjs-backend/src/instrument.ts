import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

if (process.env.BACKEND_SENTRY_DSN) {
  const traceRate = Number(process.env.BACKEND_SENTRY_TRACE_SAMPLING_RATE ?? 0.1);
  Sentry.init({
    dsn: process.env.BACKEND_SENTRY_DSN,
    tracesSampleRate: traceRate,
    skipOpenTelemetrySetup: true,
    enableLogs: true,
    _experiments: {
      enableMetrics: true,
    },
    release: process.env.NEXT_PUBLIC_BUILD_VERSION || 'development',
    environment: process.env.NODE_ENV || 'development',
    defaultIntegrations: false,
    // Only keep error-related integrations, tracing is handled by OTEL
    integrations: [
      Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
      Sentry.pinoIntegration(),
      Sentry.childProcessIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      // base
      Sentry.dedupeIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dataloaderIntegration(),
    ],
  });
  Logger.log(`Sentry initialized, tracesSampleRate: ${traceRate}`);
}
