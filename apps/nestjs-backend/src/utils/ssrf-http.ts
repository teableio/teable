import { createTrustedUrlPredicate, getSafeFetchAgent } from '@teable/v2-utils';
import nodeFetch, { type RequestInit, type Response } from 'node-fetch';

/**
 * Paved-road outbound HTTP clients: calls to user/workspace-controlled URLs
 * must go through these so SSRF filtering is applied automatically. Storage
 * SDK clients (MinIO/S3) are deliberately out of scope — they talk to fixed,
 * server-configured endpoints over their own agents.
 */

export { getSafeAxiosAgents } from '@teable/v2-utils';

/** SSRF-safe `node-fetch`; trust is re-evaluated for every redirect. */
export const safeFetch = (url: string, init?: RequestInit): Promise<Response> => {
  const filteringAgent = getSafeFetchAgent();
  if (!filteringAgent) {
    return nodeFetch(url, init);
  }
  const isTrustedFirstPartyUrl = createTrustedUrlPredicate();
  return nodeFetch(url, {
    ...init,
    agent: (parsedUrl: URL) =>
      isTrustedFirstPartyUrl(parsedUrl.href) ? undefined : filteringAgent(parsedUrl),
  });
};
