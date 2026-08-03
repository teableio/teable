export { proxy } from './lib/app-proxy';

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
