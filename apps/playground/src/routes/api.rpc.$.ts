import '@/polyfill';

import { RPCHandler } from '@orpc/server/fetch';
import { onError } from '@orpc/server';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { createFileRoute } from '@tanstack/react-router';
import { v2OrpcRouter } from '@/server/v2OrpcRouter';

const handler = new RPCHandler(v2OrpcRouter, {
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
      console.error(error);
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
