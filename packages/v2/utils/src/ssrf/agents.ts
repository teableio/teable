/* eslint-disable @typescript-eslint/naming-convention */
import { RequestFilteringHttpAgent, RequestFilteringHttpsAgent } from 'request-filtering-agent';
import { isSsrfProtectionDisabled } from './fetch';

/**
 * SSRF guards for the `http.Agent` transport stack (axios / node-fetch), the
 * counterpart to `ssrf-fetch.ts`'s undici dispatcher. Both live here so all SSRF
 * primitives share one home; pick the helper that matches your client's agent
 * shape. node-only (`request-filtering-agent` wraps Node's http/https agents).
 */

// Both agents are always returned to prevent redirect-based SSRF bypass
// (e.g., http://evil.com redirects to https://169.254.169.254). keepAlive keeps
// warm sockets for repeated hits on the same host (presigned storage URLs); the
// filtering hook runs at createConnection, unaffected by socket reuse.
const EMPTY_AGENTS = {};
const SAFE_AGENTS = {
  httpAgent: new RequestFilteringHttpAgent({ keepAlive: true }),
  httpsAgent: new RequestFilteringHttpsAgent({ keepAlive: true }),
};

const selectAgentByProtocol = (parsedUrl: URL) =>
  parsedUrl.protocol === 'https:' ? SAFE_AGENTS.httpsAgent : SAFE_AGENTS.httpAgent;

/**
 * SSRF-safe http/https agents for axios: `axios.get(url, { ...getSafeAxiosAgents() })`.
 * Returns an empty object (default agents) when protection is disabled via env var.
 */
export function getSafeAxiosAgents(): {
  httpAgent?: RequestFilteringHttpAgent;
  httpsAgent?: RequestFilteringHttpsAgent;
} {
  if (isSsrfProtectionDisabled()) {
    return EMPTY_AGENTS;
  }
  return SAFE_AGENTS;
}

/**
 * SSRF-safe `agent` option for `node-fetch`. The per-URL selector form resolves
 * the request-filtering agent at socket-connect time, so every hop — including
 * redirects — is filtered. Returns `undefined` (default agent) when protection
 * is disabled via env var, in parity with `getSafeAxiosAgents()`.
 */
export function getSafeFetchAgent():
  | ((parsedUrl: URL) => RequestFilteringHttpAgent | RequestFilteringHttpsAgent)
  | undefined {
  if (isSsrfProtectionDisabled()) {
    return undefined;
  }
  return selectAgentByProtocol;
}
