import { AFFILIATE_COOKIE_NAME } from '@teable/core';

/**
 * CANONICAL doc for the first-party affiliate cookie (`teable_affiliate_via`), shared
 * with the marketing site. The cookie — not localStorage / URL / request
 * body — is the sole carrier of the affiliate token because it:
 * - reaches the backend passively on EVERY request, including OAuth/SSO
 *   callbacks (the one signup path the frontend can never decorate);
 * - spans subdomains (`.teable.ai`), whichever host the token landed on;
 * - is server-set, so it survives Safari ITP's 7-day cap on script-written
 *   storage and every URL-relay timing hazard.
 * First-touch: the first token wins for its fixed 60-day window (aligned with
 * Rewardful's referral window); pre-widening host-only cookies are
 * deliberately not migrated. Written by the apps' proxy and the marketing
 * site's proxy; read by RequestInfoMiddleware (backend) and the Rewardful
 * bridge (client). Accepted losses: cookie-rejecting browsers (they cannot
 * hold a session either) and cross-apex clicks (teable.ai → app.teable.cn).
 */

const AFFILIATE_APEX_DOMAINS = ['teable.ai', 'teable.cn'];

/**
 * Widest domain the cookie may legally span for a host: `.teable.ai` /
 * `.teable.cn` in production, undefined (host-only) for localhost/previews —
 * a mismatched Domain attribute makes browsers reject the Set-Cookie.
 */
export const resolveAffiliateCookieDomain = (hostname: string): string | undefined => {
  const apex = AFFILIATE_APEX_DOMAINS.find(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
  return apex ? `.${apex}` : undefined;
};

/**
 * Browser-side read (`httpOnly: false` by design — the Rewardful bridge
 * consumes it). Undefined during SSR. Strips wrapping double-quotes to match
 * the backend's `cookie.parse` semantics.
 */
export const readAffiliateViaFromCookie = (): string | undefined => {
  if (typeof document === 'undefined') {
    return undefined;
  }
  for (const part of document.cookie.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1 || part.slice(0, separatorIndex).trim() !== AFFILIATE_COOKIE_NAME) {
      continue;
    }
    let rawValue = part.slice(separatorIndex + 1).trim();
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      rawValue = rawValue.slice(1, -1);
    }
    try {
      return decodeURIComponent(rawValue) || undefined;
    } catch {
      return rawValue || undefined;
    }
  }
  return undefined;
};

/**
 * Extracts the affiliate token from a landing URL: plain `?via=` first, then
 * inside a `?redirect=` param (login links carry the original URL there).
 * searchParams already percent-decodes once — decoding again would throw on
 * targets containing a literal '%' (e.g. coupon=50%off).
 */
export const extractViaFromUrl = (url: URL): string | undefined => {
  const direct = url.searchParams.get('via')?.trim();
  if (direct) {
    return direct;
  }
  const redirect = url.searchParams.get('redirect');
  if (!redirect) {
    return undefined;
  }
  try {
    const embedded = new URL(redirect, url.origin);
    return embedded.searchParams.get('via')?.trim() || undefined;
  } catch {
    return undefined;
  }
};
