import type { ISsrfSafeFetchFn } from './fetch';

/**
 * Process-wide `safeFetch` registry. Node hosts register an SSRF-guarded fetch
 * (`createSsrfSafeFetch`) once at boot; adapters then import `safeFetch`
 * directly instead of threading a `fetchFn` through constructors. Deliberately
 * undici-free so browser bundles can import it — unregistered hosts (browser,
 * unit tests) fall back to the global fetch.
 */

let registeredFetch: ISsrfSafeFetchFn | undefined;

/** Registers the `safeFetch` implementation; pass `undefined` to restore the global-fetch fallback (tests). */
export function setSafeFetch(fetchFn: ISsrfSafeFetchFn | undefined): void {
  registeredFetch = fetchFn;
}

/**
 * Fetch for user-controlled URLs (CSV/Excel import sources). Resolves the
 * registered implementation at call time, so importing it at module scope is
 * always safe regardless of registration order.
 */
export const safeFetch: ISsrfSafeFetchFn = (url, init) =>
  (registeredFetch ?? globalThis.fetch)(url, init);
