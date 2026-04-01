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
