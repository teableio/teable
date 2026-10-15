import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getLocaleDetection } from './i18n/getLocale';

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

  const response = NextResponse.next();
  response.headers.set('X-Server-Locale', locale);
  response.headers.set('X-Robots-Tag', APP_ROBOTS_TAG);
  return response;
}
