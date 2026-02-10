import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';

import { PLAYGROUND_DB_URL_HEADER, resolvePlaygroundDbUrl } from '@/lib/playground/databaseUrl';
type V2ContractRouter = (typeof import('@teable/v2-contract-http'))['v2Contract'];
type V2OrpcClient = ContractRouterClient<V2ContractRouter>;

let serverClient: V2OrpcClient | null = null;

if (import.meta.env.SSR) {
  const [{ createRouterClient }, { v2OrpcRouter }, { getRequestHeaders }] = await Promise.all([
    import('@orpc/server'),
    import('@/server/v2OrpcRouter'),
    import('@tanstack/react-start/server'),
  ]);

  serverClient = createRouterClient(v2OrpcRouter, {
    context: () => ({
      headers: getRequestHeaders(),
    }),
  }) as V2OrpcClient;
}

export const getRemoteOrpcClient = (): V2OrpcClient => {
  if (import.meta.env.SSR) {
    if (!serverClient) {
      throw new Error('Server ORPC client is not initialized.');
    }
    return serverClient;
  }

  const link = new RPCLink({
    url: `${window.location.origin}/api/rpc`,
    adapterInterceptors: [
      async (options) => {
        const { request, next, ...rest } = options;
        const dbUrl = resolvePlaygroundDbUrl();
        if (!dbUrl) {
          return next({ ...rest, request });
        }
        const headers = new Headers(request.headers);
        headers.set(PLAYGROUND_DB_URL_HEADER, dbUrl);
        const nextRequest = new Request(request, { headers });
        return next({ ...rest, request: nextRequest });
      },
    ],
  });
  return createORPCClient(link) as V2OrpcClient;
};
