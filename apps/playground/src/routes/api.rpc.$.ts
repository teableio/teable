import '@/polyfill';

import { LoggingHandlerPlugin } from '@orpc/experimental-pino';
import { RPCHandler } from '@orpc/server/fetch';
import { onError } from '@orpc/server';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { createFileRoute } from '@tanstack/react-router';
import { playgroundPinoLogger } from '@/server/playgroundLogger';
import { v2OrpcRouter } from '@/server/v2OrpcRouter';
import { extractRequestContext } from '@/server/traceContext';
import { applyTraceHeaders } from '@/server/traceResponseHeaders';
import { withPlaygroundDbContext } from '@/server/playgroundDbContext';
import { PLAYGROUND_DB_URL_HEADER } from '@/lib/playground/databaseUrl';

const generateRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const handler = new RPCHandler(v2OrpcRouter, {
  plugins: [
    new LoggingHandlerPlugin({
      logger: playgroundPinoLogger,
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
      playgroundPinoLogger.error(errorObject, 'oRPC handler error');
    }),
  ],
});

async function handle({ request }: { request: Request }) {
  const tracer = trace.getTracer('orpc');
  const parentContext = extractRequestContext(request);
  return tracer.startActiveSpan(
    'orpc.request',
    { attributes: { 'rpc.system': 'orpc' } },
    parentContext,
    async (span) => {
      try {
        const connectionString = request.headers.get(PLAYGROUND_DB_URL_HEADER)?.trim() || undefined;
        const { response } = await withPlaygroundDbContext(connectionString, () =>
          handler.handle(request, {
            prefix: '/api/rpc',
            context: {},
          })
        );

        const finalResponse = response ?? new Response('Not Found', { status: 404 });
        span.setAttribute('http.status_code', finalResponse.status);
        if (finalResponse.status >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        return applyTraceHeaders(finalResponse, span.spanContext());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        span.recordException(error instanceof Error ? error : message);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        throw error;
      } finally {
        span.end();
      }
    }
  );
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
