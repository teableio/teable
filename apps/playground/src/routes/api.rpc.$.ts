import '@/polyfill';

import { RPCHandler } from '@orpc/server/fetch';
import { onError } from '@orpc/server';
import { createFileRoute } from '@tanstack/react-router';
import { v2OrpcRouter } from '@/server/v2OrpcRouter';

const handler = new RPCHandler(v2OrpcRouter, {
  interceptors: [
    onError((error) => {
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
