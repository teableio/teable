import {
  createTrustedUrlPredicate,
  getSafeFetchAgent,
  type ISafeAgentOptions,
} from '@teable/v2-utils';
import nodeFetch, { type RequestInit, type Response } from 'node-fetch';

/**
 * Paved-road outbound HTTP clients: calls to user/workspace-controlled URLs
 * must go through these so SSRF filtering is applied automatically. Storage
 * SDK clients (MinIO/S3) are deliberately out of scope — they talk to fixed,
 * server-configured endpoints over their own agents.
 */

export { getSafeAxiosAgents, type ISafeAgentOptions } from '@teable/v2-utils';

/**
 * SSRF-filtering `http.Agent` for one request to `url`, for clients that take a
 * per-request agent but are not fetch/axios. `undefined` means the default agent:
 * the URL is a trusted first-party origin, or protection is disabled.
 */
export const getSafeAgentForUrl = (url: string, options?: ISafeAgentOptions) => {
  const filteringAgent = getSafeFetchAgent(options);
  if (!filteringAgent) {
    return undefined;
  }
  return createTrustedUrlPredicate()(url) ? undefined : filteringAgent(new URL(url));
};

/** SSRF-safe `node-fetch`; trust is re-evaluated for every redirect. */
export const safeFetch = (
  url: string,
  init?: RequestInit,
  options?: ISafeAgentOptions
): Promise<Response> => {
  const filteringAgent = getSafeFetchAgent(options);
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
