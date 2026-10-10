/**
 * Marker cookie set once a browser has held a signed-in session. Its only
 * purpose is routing: unauthenticated visitors on a browser that carries it are
 * sent to sign-in instead of sign-up. It is a hint, never an identity — the
 * session cookie alone decides who is logged in.
 * Written by the Next SSR guard (apps/nextjs-app/src/lib/returning-user-cookie.ts),
 * read there and by the SDK's client-side 401 handler (`document.cookie`, so it
 * is deliberately not httpOnly).
 */
export const RETURNING_USER_COOKIE_NAME = 'teable_returning';

export const RETURNING_USER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Auth page for an unauthenticated visitor: `/auth/login` when the browser is a
 * returning one, `/auth/signup` otherwise. `redirect` is the original URL to
 * come back to after authenticating.
 */
export const getUnauthenticatedAuthPath = (isReturning: boolean, redirect?: string): string => {
  const path = isReturning ? '/auth/login' : '/auth/signup';
  return redirect ? `${path}?redirect=${encodeURIComponent(redirect)}` : path;
};
