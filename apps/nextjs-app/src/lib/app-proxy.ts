import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { captureAffiliateVia } from './affiliate-cookie-proxy';
import { getLocaleDetection } from './i18n/getLocale';

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
      locales: ['en', 'it', 'de', 'zh', 'fr', 'ja', 'ru', 'uk', 'tr', 'es', 'ko'],
    },
  });

  // Affiliate ?via= capture (cookie + URL cleanup) — may return a redirect.
  const response = captureAffiliateVia(request) ?? NextResponse.next();
  response.headers.set('X-Server-Locale', locale);
  return response;
}
