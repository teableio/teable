import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';

import { createRouterClient } from '@orpc/server';
import { v2OrpcRouter } from '@/server/v2OrpcRouter';

type V2ContractRouter = (typeof import('@teable/v2-contract-http'))['v2Contract'];
type V2OrpcClient = ContractRouterClient<V2ContractRouter>;

export const getOrpcClient = createIsomorphicFn()
  .server(
    () =>
      createRouterClient(v2OrpcRouter, {
        context: () => ({
          headers: getRequestHeaders(),
        }),
      }) as V2OrpcClient
  )
  .client(() => {
    const link = new RPCLink({
      url: `${window.location.origin}/api/rpc`,
    });
    return createORPCClient(link) as V2OrpcClient;
  });
