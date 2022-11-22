import type * as server from 'next/server';
import { NextResponse } from 'next/server';
import { getLocaleDetection } from './lib/i18n/getLocale';

export function middleware(request: server.NextRequest) {
  const locale = getLocaleDetection({
    req: request,
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'de', 'zh'],
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
   * - favicon.ico (favicon file)
   */
  matcher: '/((?!api|_next/static|favicon.ico).*)',
};
