// This file configures the initialization of Sentry on the client.
// The config you add here will be used whenever a users loads a page in their browser.
// Next.js 15.3+ loads this file natively for both Turbopack and webpack builds;
// sentry.client.config.ts is only injected by the webpack plugin and is dead code under Turbopack.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

declare global {
  interface Window {
    __TE__: { sentryDsn?: string; buildVersion?: string };
  }
}

Sentry.init({
  release: window.__TE__?.buildVersion ?? process.env.APP_VERSION,
  dsn: process.env.SENTRY_DSN || window.__TE__?.sentryDsn,
  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 1,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Sentry 11 reports the user's IP by default; keep what v10 sent without sendDefaultPii.
  dataCollection: { userInfo: false },

  // Report an error only when its innermost frame is our own bundle (/_next/, also behind an
  // assetPrefix CDN); errors without frames still pass. Extensions, userscripts and proxies that
  // wrap window.fetch leave its rejection unhandled, so every failed PostHog/GA request surfaces as
  // "Failed to fetch (<host>)" with their script innermost, whatever they named it. Matched on the
  // raw URL: the Next.js frame normalization later rewrites every origin, chrome-extension://
  // included, to app:///, so Sentry's server-side browser-extension filter never recognises them.
  allowUrls: [/\/_next\//],

  replaysOnErrorSampleRate: 1.0,

  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // You can remove this option if you're not planning to use the Sentry Session Replay feature:
  integrations: [],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
