import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { enrichSentryEventWithDomainError } from './sentry-domain-error';
import { resolveBuildVersion } from './utils/build-version';

if (process.env.BACKEND_SENTRY_DSN) {
  const traceRate = Number(process.env.BACKEND_SENTRY_TRACE_SAMPLING_RATE ?? 0.1);
  Sentry.init({
    dsn: process.env.BACKEND_SENTRY_DSN,
    tracesSampleRate: traceRate,
    // tracing.ts owns the OpenTelemetry SDK; Sentry must not register a second provider.
    enableOpenTelemetrySetup: false,
    release: resolveBuildVersion() || 'development',
    environment: process.env.NODE_ENV || 'development',
    defaultIntegrations: false,
    // Only keep error-related integrations, tracing is handled by OTEL; openTelemetryIntegration
    // stamps the active OTEL span's trace id on each event so SigNoz and Sentry line up.
    integrations: [
      Sentry.openTelemetryIntegration(),
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
    beforeSend(event, hint) {
      return enrichSentryEventWithDomainError(event, hint);
    },
  });
  Logger.log(`Sentry initialized, tracesSampleRate: ${traceRate}`);
}
