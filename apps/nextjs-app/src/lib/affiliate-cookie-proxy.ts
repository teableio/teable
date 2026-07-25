import {
  AFFILIATE_COOKIE_MAX_AGE_SECONDS,
  AFFILIATE_COOKIE_NAME,
  AFFILIATE_VIA_MAX_LENGTH,
} from '@teable/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { extractViaFromUrl, resolveAffiliateCookieDomain } from './affiliate-cookie';

const hostnameFromOrigin = (origin: string | undefined): string | undefined => {
  if (!origin) {
    return undefined;
  }
  try {
    return new URL(origin).hostname;
  } catch {
    return undefined;
  }
};

/**
 * Widest legal Domain for the cookie, from the first candidate hostname that
 * maps to a production apex. Self-hosted Next builds `nextUrl` from the
 * server's bind address (localhost) — only Vercel's trustHostHeader puts the
 * real domain there — so the browser-visible host must come from the
 * forwarded headers, with PUBLIC_ORIGIN as the backstop should some proxy hop
 * rewrite Host without setting x-forwarded-host. Accepted trade-off: a
 * `?via=` landing on a custom domain resolves to the PUBLIC_ORIGIN apex and
 * the browser rejects the mismatched cookie — affiliate links only target the
 * main domains, and every non-apex outcome degrades to a host-only cookie,
 * never worse than no capture.
 */
const resolveCookieDomainForRequest = (request: NextRequest): string | undefined => {
  const candidates = [
    request.headers.get('x-forwarded-host')?.split(',')[0],
    request.headers.get('host'),
    hostnameFromOrigin(process.env.PUBLIC_ORIGIN),
    request.nextUrl.hostname,
  ];
  for (const candidate of candidates) {
    const hostname = candidate?.split(':')[0].trim().toLowerCase();
    const domain = hostname ? resolveAffiliateCookieDomain(hostname) : undefined;
    if (domain) {
      return domain;
    }
  }
  return undefined;
};

/**
 * Proxy-side `?via=` capture: plant the first-touch cookie, 307 to the
 * via-stripped URL. See affiliate-cookie.ts for the cookie contract.
 * Kept apart from that module so client bundles never pull in next/server.
 * Returns null when the request carries no token.
 */
export function captureAffiliateVia(request: NextRequest): NextResponse | null {
  const via = extractViaFromUrl(request.nextUrl);
  if (!via) {
    return null;
  }

  let response: NextResponse;
  if (request.nextUrl.searchParams.has('via')) {
    const cleanUrl = request.nextUrl.clone();
    cleanUrl.searchParams.delete('via');
    response = NextResponse.redirect(cleanUrl);
  } else {
    response = NextResponse.next();
  }

  if (!request.cookies.has(AFFILIATE_COOKIE_NAME)) {
    const domain = resolveCookieDomainForRequest(request);
    response.cookies.set({
      name: AFFILIATE_COOKIE_NAME,
      value: via.slice(0, AFFILIATE_VIA_MAX_LENGTH),
      maxAge: AFFILIATE_COOKIE_MAX_AGE_SECONDS,
      sameSite: 'lax',
      path: '/',
      // The production apexes are HTTPS-only, so a widened cookie is always
      // Secure — nextUrl.protocol alone would miss a proxy hop that drops
      // x-forwarded-proto while PUBLIC_ORIGIN still resolves the Domain.
      secure: !!domain || request.nextUrl.protocol === 'https:',
      httpOnly: false,
      ...(domain ? { domain } : {}),
    });
  }
  return response;
}
