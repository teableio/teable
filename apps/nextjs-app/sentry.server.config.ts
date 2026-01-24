// Sentry server-side config for Next.js
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  release: process.env.NEXT_PUBLIC_BUILD_VERSION,
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1,
  debug: false,
  // Use Next.js built-in OTEL instead of Sentry's
  skipOpenTelemetrySetup: true,
  // Disable HttpServer to avoid conflict with Next.js OTEL (causes stack overflow)
  integrations: (defaults) => defaults.filter((i) => i.name !== 'HttpServer'),
});
