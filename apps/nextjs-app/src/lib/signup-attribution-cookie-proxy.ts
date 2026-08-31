import {
  capSignupAttributionParams,
  pickSignupAttributionParams,
  SIGNUP_ATTRIBUTION_COOKIE_MAX_AGE_SECONDS,
  SIGNUP_ATTRIBUTION_COOKIE_NAME,
} from '@teable/core';
import type { NextRequest, NextResponse } from 'next/server';
import { resolveCookieDomainForRequest } from './affiliate-cookie-proxy';

/**
 * Proxy-side first-touch capture of utm/click-id params into the
 * `teable_attribution` cookie (JSON of the whitelisted params — contract in
 * @teable/core attribution.ts). Sibling of `captureAffiliateVia`, with two
 * deliberate differences:
 * - No redirect/URL cleanup: posthog-js and gtag read these params client-side,
 *   so they must stay in the URL.
 * - `httpOnly`: nothing client-side needs to read the cookie — only the
 *   backend's RequestInfoMiddleware consumes it at signup.
 * First-touch wins: an existing cookie is never overwritten (mirrors the
 * affiliate cookie and the `$set_once` semantics downstream).
 */
export function captureSignupAttribution(request: NextRequest, response: NextResponse): void {
  if (request.cookies.has(SIGNUP_ATTRIBUTION_COOKIE_NAME)) {
    return;
  }
  // Whitelist + per-value cap, then the aggregate payload cap (an oversized
  // Set-Cookie is dropped whole by browsers — shed low-priority keys instead).
  const params = capSignupAttributionParams(
    pickSignupAttributionParams((key) => request.nextUrl.searchParams.get(key))
  );
  if (!Object.keys(params).length) {
    return;
  }
  const domain = resolveCookieDomainForRequest(request);
  response.cookies.set({
    name: SIGNUP_ATTRIBUTION_COOKIE_NAME,
    value: JSON.stringify(params),
    maxAge: SIGNUP_ATTRIBUTION_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax',
    path: '/',
    // Same rationale as the affiliate cookie: production apexes are
    // HTTPS-only, and a proxy hop may drop x-forwarded-proto.
    secure: !!domain || request.nextUrl.protocol === 'https:',
    httpOnly: true,
    ...(domain ? { domain } : {}),
  });
}
