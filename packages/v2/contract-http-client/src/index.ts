import { createORPCClient } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { v2Contract } from '@teable/v2-contract-http';

import { decodeStandardV2ErrorBody } from './errorDecoder';

export { v2Contract } from '@teable/v2-contract-http';
export * from './dataQuery';
export * from './vcs';

export interface IV2HttpClientOptions {
  baseUrl: string;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  fetch?: typeof fetch;
}

export type V2HttpClient = ContractRouterClient<typeof v2Contract>;

export const createV2HttpClient = (options: IV2HttpClientOptions): V2HttpClient => {
  const link = new OpenAPILink(v2Contract, {
    url: options.baseUrl,
    headers: options.headers,
    fetch: options.fetch,
    customErrorResponseBodyDecoder: (body, response) =>
      decodeStandardV2ErrorBody(body, response.status),
  });

  return createORPCClient(link) as ContractRouterClient<typeof v2Contract>;
};
