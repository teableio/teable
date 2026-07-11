/* eslint-disable @typescript-eslint/naming-convention */
import type {
  RequestFilteringHttpAgent,
  RequestFilteringHttpsAgent,
} from 'request-filtering-agent';
import { globalHttpAgent, globalHttpsAgent } from 'request-filtering-agent';

const isSsrfProtectionDisabled = () => process.env.TEABLE_SSRF_PROTECTION_DISABLED === 'true';

// Both agents are always returned to prevent redirect-based SSRF bypass
// (e.g., http://evil.com redirects to https://169.254.169.254)
const EMPTY_AGENTS = {};
const SAFE_AGENTS = { httpAgent: globalHttpAgent, httpsAgent: globalHttpsAgent };

/**
 * Returns SSRF-safe HTTP agents for use with axios.
 * When SSRF protection is disabled via env var, returns an empty object
 * so that axios uses its default agents.
 *
 * Usage: `axios.get(url, { ...getSsrfSafeAgents() })`
 */
export function getSsrfSafeAgents(): {
  httpAgent?: RequestFilteringHttpAgent;
  httpsAgent?: RequestFilteringHttpsAgent;
} {
  if (isSsrfProtectionDisabled()) {
    return EMPTY_AGENTS;
  }
  return SAFE_AGENTS;
}

/**
 * Returns an SSRF-safe agent selector for use with node-fetch:
 *   `fetch(url, { agent: getSsrfSafeFetchAgent() })`
 * node-fetch's `agent` option accepts a `(parsedUrl) => Agent` factory (unlike
 * axios' `httpAgent`/`httpsAgent`), so we pick the http or https request-filtering
 * agent per URL. This also blocks redirect-based bypasses
 * (e.g. http://evil.com -> https://169.254.169.254). Returns undefined when SSRF
 * protection is disabled via env var, so node-fetch uses its default agents.
 */
export function getSsrfSafeFetchAgent():
  | ((parsedUrl: URL) => RequestFilteringHttpAgent | RequestFilteringHttpsAgent)
  | undefined {
  if (isSsrfProtectionDisabled()) {
    return undefined;
  }
  return (parsedUrl: URL) =>
    parsedUrl.protocol === 'https:' ? globalHttpsAgent : globalHttpAgent;
}
