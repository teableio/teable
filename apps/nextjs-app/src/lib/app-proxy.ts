import { CONSENT_REGION_COOKIE_NAME, consentRegionForCountry } from '@teable/core';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { captureAffiliateVia } from './affiliate-cookie-proxy';
import { getLocaleDetection } from './i18n/getLocale';
import { captureSignupAttribution } from './signup-attribution-cookie-proxy';

export const APP_ROBOTS_TAG = 'noindex, nofollow';

/**
 * The single proxy implementation shared by the community and EE apps —
 * Next allows one proxy file per app, so each app's proxy.ts re-exports this
 * (plus its own static `config` matcher, which Next requires in-file).
 */
export function proxy(request: NextRequest) {
  const locale = getLocaleDetection({
    req: request,
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'it', 'de', 'zh', 'fr', 'ja', 'ru', 'uk', 'tr', 'es', 'ar', 'he'],
    },
  });

  // Affiliate ?via= capture (cookie + URL cleanup) — may return a redirect.
  const response = captureAffiliateVia(request) ?? NextResponse.next();
  // First-touch utm/click-id capture — cookie only, URL untouched (works on
  // the affiliate redirect too: the cookie rides the 307 and the params
  // survive, since only `via` gets stripped).
  captureSignupAttribution(request, response);
  syncConsentRegion(request, response);
  response.headers.set('X-Server-Locale', locale);
  response.headers.set('X-Robots-Tag', APP_ROBOTS_TAG);
  return response;
}

/**
 * Hands the visitor's consent region (opt-in EEA/UK/CH vs. the rest of the
 * world) to the client, which decides whether to show the cookie banner and
 * how analytics may run. Cloudflare sets `cf-ipcountry` in front of the cloud
 * app; without it (self-hosted, local dev) the region falls back to opt-in.
 */
function syncConsentRegion(request: NextRequest, response: NextResponse) {
  const region = consentRegionForCountry(request.headers.get('cf-ipcountry'));
  if (request.cookies.get(CONSENT_REGION_COOKIE_NAME)?.value === region) {
    return;
  }
  response.cookies.set(CONSENT_REGION_COOKIE_NAME, region, {
    path: '/',
    maxAge: 24 * 60 * 60,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
  });
}
