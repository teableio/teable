import ipaddr from 'ipaddr.js';
import { Agent, buildConnector, type Dispatcher } from 'undici';

/**
 * Shared SSRF-safe `fetch` machinery for v2 Node hosts: an undici dispatcher
 * that rejects non-public resolved peer IPs on every hop (covers redirects and
 * DNS rebinding). Isomorphic adapters stay undici-free — Node containers
 * inject an SSRF-guarded fetch instead.
 */

/**
 * Fetch function for guarded URL sources: same call shape as global `fetch`.
 * Node containers inject `createSsrfSafeFetch`'s implementation; isomorphic
 * consumers depend only on this type and stay undici-free.
 */
export type ISsrfSafeFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const isSsrfProtectionDisabled = () =>
  process.env.TEABLE_SSRF_PROTECTION_DISABLED === 'true';

/**
 * Blocks anything that is not a public unicast address (loopback, private,
 * link-local, reserved, …). Fails closed on unparseable input.
 */
export function isBlockedAddress(ip: string): boolean {
  try {
    return ipaddr.process(ip).range() !== 'unicast';
  } catch {
    return true;
  }
}

/**
 * Mirror of `READ_PATH` in `@teable/openapi` (v2 packages cannot depend on it);
 * the backend's `ssrf-http.spec.ts` pins the two against each other.
 */
export const ATTACHMENT_READ_PATH = '/api/attachments/read';

/** Dedupe candidate URLs down to their origins, skipping blank/malformed entries. */
export function normalizeOrigins(candidates: readonly (string | undefined)[]): string[] {
  const origins = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // malformed origin → skip
    }
  }
  return [...origins];
}

/**
 * True only for the token-gated attachment-read endpoint on an allowed
 * first-party origin — the sole bypass of the SSRF dispatcher. Single
 * definition shared by V1 `safeFetch` and the V2 provider.
 */
export function isTrustedInternalReadUrl(
  url: string,
  allowedOrigins: readonly string[] = []
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!parsed.pathname.startsWith(`${ATTACHMENT_READ_PATH}/`)) return false;
  return allowedOrigins.includes(parsed.origin);
}

/** True when the URL matches one of the explicitly trusted origins exactly. */
function isTrustedExactOriginUrl(url: string, trustedOrigins: readonly string[]): boolean {
  if (trustedOrigins.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return trustedOrigins.includes(parsed.origin);
}

function getTrustedStorageOrigins(): string[] {
  const provider = process.env.BACKEND_STORAGE_PROVIDER ?? 'local';
  if (provider === 'local') return [];

  const candidates: (string | undefined)[] = [
    process.env.BACKEND_STORAGE_PUBLIC_URL,
    process.env.BACKEND_STORAGE_PRIVATE_BUCKET_ENDPOINT,
  ];
  if (provider === 'minio') {
    const endpoint = process.env.BACKEND_STORAGE_MINIO_ENDPOINT;
    const internalEndpoint = process.env.BACKEND_STORAGE_MINIO_INTERNAL_ENDPOINT;
    candidates.push(
      endpoint &&
        `${process.env.BACKEND_STORAGE_MINIO_USE_SSL === 'true' ? 'https' : 'http'}://${endpoint}:${Number(process.env.BACKEND_STORAGE_MINIO_PORT ?? 9000)}`,
      internalEndpoint &&
        `http://${internalEndpoint}:${Number(process.env.BACKEND_STORAGE_MINIO_INTERNAL_PORT ?? 9000)}`
    );
  } else {
    candidates.push(
      process.env.BACKEND_STORAGE_S3_ENDPOINT,
      process.env.BACKEND_STORAGE_S3_INTERNAL_ENDPOINT
    );
  }
  return normalizeOrigins(candidates);
}

function resolveTrustedOrigins(): {
  exactOrigins: string[];
  readOrigins: string[];
} {
  const publicOrigin = process.env.PUBLIC_ORIGIN;
  const envOrigins = process.env.TEABLE_SSRF_TRUSTED_ORIGINS?.split(',').map((value) =>
    value.trim()
  );
  const exactOrigins = normalizeOrigins([
    publicOrigin,
    ...(envOrigins ?? []),
    ...getTrustedStorageOrigins(),
  ]);
  const readOrigins = normalizeOrigins([
    process.env.STORAGE_PREFIX ?? publicOrigin,
    `http://localhost:${process.env.PORT}`,
  ]).filter((origin) => !exactOrigins.includes(origin));
  return { exactOrigins, readOrigins };
}

/** Builds the shared URL trust predicate used by both fetch implementations. */
export function createTrustedUrlPredicate(): (url: string) => boolean {
  const { exactOrigins, readOrigins } = resolveTrustedOrigins();
  return (url) =>
    isTrustedExactOriginUrl(url, exactOrigins) || isTrustedInternalReadUrl(url, readOrigins);
}

/** undici Agent whose connector rejects non-public resolved peer IPs. */
function createStrictSsrfAgent(): Agent {
  const baseConnector = buildConnector({});
  const connector: buildConnector.connector = (options, callback) => {
    baseConnector(options, (err, socket) => {
      if (err || !socket) {
        callback(err ?? new Error('SSRF guard: connection failed'), null);
        return;
      }
      const remote = socket.remoteAddress;
      if (!remote || isBlockedAddress(remote)) {
        socket.destroy();
        callback(
          new Error(`SSRF guard: ${remote ?? 'unknown host'} is not a public address`),
          null
        );
        return;
      }
      callback(null, socket);
    });
  };
  return new Agent({ connect: connector });
}

let strictSsrfAgent: Agent | undefined;

function getStrictSsrfAgent(): Agent {
  strictSsrfAgent ??= createStrictSsrfAgent();
  return strictSsrfAgent;
}

/** Plain agent for URLs the full-URL predicate trusts; only reachable through the routing dispatcher. */
let trustedAgent: Agent | undefined;

function getTrustedAgent(): Agent {
  trustedAgent ??= new Agent({});
  return trustedAgent;
}

/**
 * Dispatcher that re-runs the full-URL trust predicate on EVERY dispatch —
 * `fetch` re-dispatches each redirect hop through the request's dispatcher, so
 * unlike a connector (which only sees host:port) this keeps path-level trust
 * (`/api/attachments/read/*`) intact across hops, matching V1 `safeFetch`'s
 * per-hop agent selector. Fails closed: unparseable dispatch targets go strict.
 *
 * The predicate is rebuilt per dispatch so env-derived origins are read at
 * request time, never frozen at registration (V1 parity): hosts may finalize
 * `STORAGE_PREFIX`/`PORT` after the container registers this fetch.
 */
function createRoutingDispatcher(): Dispatcher {
  return getStrictSsrfAgent().compose((dispatch) => (opts, handler) => {
    let trusted = false;
    try {
      trusted = createTrustedUrlPredicate()(new URL(opts.path ?? '/', opts.origin).href);
    } catch {
      // no/invalid origin → strict
    }
    return trusted ? getTrustedAgent().dispatch(opts, handler) : dispatch(opts, handler);
  });
}

/** Default SSRF-guarded fetch for Node containers; bypass parity with V1 `safeFetch`. */
export function createSsrfSafeFetch(): ISsrfSafeFetchFn {
  if (isSsrfProtectionDisabled()) {
    return (url, init) => fetch(url, init);
  }
  // One routing dispatcher for every URL: trust is decided per dispatch (i.e.
  // per redirect hop) against the full URL, never baked in at request start.
  const dispatcher = createRoutingDispatcher();
  // Boundary cast: `@types/node` types `RequestInit.dispatcher` against a
  // different `undici-types` version than the `undici` we run (type-only skew).
  return (url, init) => fetch(url, { ...init, dispatcher } as unknown as RequestInit);
}
