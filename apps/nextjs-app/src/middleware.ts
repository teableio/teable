import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getLocaleDetection } from './lib/i18n/getLocale';

export function middleware(request: NextRequest) {
  const locale = getLocaleDetection({
    req: request,
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'it', 'de', 'zh', 'fr', 'ja', 'ru', 'uk', 'tr', 'es'],
    },
  });

  const response = NextResponse.next();
  response.headers.set('X-Server-Locale', locale);
  return response;
}

export const config = {
  /*
   * Match all request paths except for the ones starting with:
   * - api (API routes)
   * - _next/static (static files)
   * - _next/image (image optimization files)
   * - favicon.ico (favicon file)
   * - socket (Ws)
   */
  matcher: '/((?!api|_next/static|_next/image|favicon.ico|socket).*)',
};
