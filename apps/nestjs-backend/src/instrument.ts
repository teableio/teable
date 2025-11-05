import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

if (process.env.BACKEND_SENTRY_DSN) {
  const traceRate = Number(process.env.BACKEND_SENTRY_TRACE_SAMPLING_RATE ?? 0.1);
  Sentry.init({
    dsn: process.env.BACKEND_SENTRY_DSN,
    tracesSampleRate: traceRate,
    beforeSendTransaction(event) {
      if (event.spans) {
        event.spans = event.spans.filter((span) => {
          const description = span.description || '';
          const durationMs = (span.timestamp || 0) - (span.start_timestamp || 0);
          const durationInMs = durationMs * 1000;
          if (['ValidationPipe', 'Interceptors - After Route'].includes(description)) {
            return false;
          }

          // prisma spans <= 50ms are not interesting
          if (
            [
              'prisma:client:operation',
              'prisma:client:serialize',
              'prisma:engine:query',
              'prisma:engine:response_json_serialization',
              'prisma:engine:serialize',
              'prisma:engine:connection',
            ].includes(description) &&
            durationInMs <= 50
          ) {
            return false;
          }

          return true;
        });
      }
      return event;
    },
    enableLogs: true,
    release: process.env.NEXT_PUBLIC_BUILD_VERSION || 'development',
    environment: process.env.NODE_ENV || 'development',
    defaultIntegrations: false,
    integrations: [
      Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
      Sentry.httpIntegration({
        ignoreIncomingRequests: (_urlPath: string, request: IncomingMessage) => {
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
      Sentry.nestIntegration(),
      Sentry.prismaIntegration(),
      Sentry.pinoIntegration(),
      Sentry.childProcessIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.nativeNodeFetchIntegration(),
      // base
      Sentry.dedupeIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.linkedErrorsIntegration(),
    ],
  });
  Logger.log(`Sentry initialized, tracesSampleRate: ${traceRate}`);
}
