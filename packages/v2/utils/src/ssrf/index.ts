// All SSRF primitives, one home. Two transport stacks, one shared trust model:
// - agents.ts   → http.Agent stack (axios / node-fetch), via request-filtering-agent
// - fetch.ts    → undici dispatcher (isomorphic global fetch) + shared predicates
// - registry.ts → process-wide `safeFetch` used directly by URL-sourced adapters
export { getSafeAxiosAgents, getSafeFetchAgent } from './agents';
export { safeFetch, setSafeFetch } from './registry';
export {
  ATTACHMENT_READ_PATH,
  createSsrfSafeFetch,
  createTrustedUrlPredicate,
  normalizeOrigins,
  type ISsrfSafeFetchFn,
} from './fetch';
