import type { IncomingMessage } from 'node:http';
import * as Sentry from '@sentry/nestjs';

if (process.env.BACKEND_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.BACKEND_SENTRY_DSN,
    tracesSampleRate: 1.0,
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
}
