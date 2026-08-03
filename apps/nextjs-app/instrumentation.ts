// This file is required by Next.js 15+ for Sentry integration
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  // Edge Runtime config - create sentry.edge.config.ts if using Middleware or Edge API Routes
  // if (process.env.NEXT_RUNTIME === 'edge') {
  //   await import('./sentry.edge.config');
  // }
}

export const onRequestError = async (
  err: Error,
  request: {
    path: string;
    method: string;
    headers: Record<string, string>;
  },
  context: {
    routerKind: string;
    routePath: string;
    routeType: string;
    renderSource?: string;
    revalidateReason?: string;
    serverComponentType?: string;
  }
) => {
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureException(err, {
    extra: {
      request,
      context,
    },
  });
};
