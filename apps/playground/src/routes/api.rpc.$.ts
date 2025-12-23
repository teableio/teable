import '@/polyfill';

import { LoggingHandlerPlugin } from '@orpc/experimental-pino';
import { RPCHandler } from '@orpc/server/fetch';
import { onError } from '@orpc/server';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { createFileRoute } from '@tanstack/react-router';
import { v2PinoLogger } from '@teable/v2-adapter-logger-pino';
import { v2OrpcRouter } from '@/server/v2OrpcRouter';

const generateRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const handler = new RPCHandler(v2OrpcRouter, {
  plugins: [
    new LoggingHandlerPlugin({
      logger: v2PinoLogger,
      generateId: generateRequestId,
      logRequestResponse: true,
      logRequestAbort: true,
    }),
  ],
  interceptors: [
    ({ request, next }) => {
      const span = trace.getActiveSpan();
      span?.setAttribute('rpc.system', 'orpc');
      request.signal?.addEventListener('abort', () => {
        span?.addEvent('aborted', { reason: String(request.signal?.reason ?? 'unknown') });
      });
      return next();
    },
    onError((error) => {
      const span = trace.getActiveSpan();
      if (span) {
        const message = error instanceof Error ? error.message : String(error);
        span.recordException(error instanceof Error ? error : message);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
      }
      const errorObject = error instanceof Error ? error : new Error(String(error));
      v2PinoLogger.error(errorObject, 'oRPC handler error');
    }),
  ],
});

async function handle({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: {},
  });

  return response ?? new Response('Not Found', { status: 404 });
}

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      HEAD: handle,
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
});
