import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { v2Contract } from '@teable/v2-contract-http';

export interface IV2RpcClientOptions {
  baseUrl: string;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  fetch?: typeof fetch;
}

export const createV2RpcClient = (options: IV2RpcClientOptions) => {
  const link = new RPCLink({
    url: options.baseUrl,
    headers: options.headers,
    fetch: options.fetch,
  });

  return createORPCClient(link) as ContractRouterClient<typeof v2Contract>;
};
