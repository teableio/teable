import {
  getUnauthenticatedAuthPath,
  RETURNING_USER_COOKIE_MAX_AGE_SECONDS,
  RETURNING_USER_COOKIE_NAME,
} from '@teable/core';
import type { GetServerSidePropsContext } from 'next';

type SsrRequest = GetServerSidePropsContext['req'];

const hasReturningUserCookie = (req: SsrRequest): boolean =>
  Boolean(req.cookies?.[RETURNING_USER_COOKIE_NAME]);

/**
 * Destination for an SSR redirect of an unauthenticated visitor — sign-in for a
 * browser that has been signed in before, sign-up otherwise. Contract in
 * @teable/core returning-user.ts.
 */
export const getUnauthenticatedRedirect = (req: SsrRequest | undefined): string =>
  getUnauthenticatedAuthPath(!!req && hasReturningUserCookie(req), req?.url || undefined);

/**
 * Stamps the returning-user cookie on the response once a signed-in user is
 * observed during SSR. Idempotent: skipped when the browser already carries it.
 * Host-only and non-httpOnly (the SDK reads it client-side); `Secure` follows
 * the proxy-reported scheme so local http dev keeps working.
 */
export const markReturningUser = (context: GetServerSidePropsContext): void => {
  const { req, res } = context;
  if (hasReturningUserCookie(req)) {
    return;
  }
  const forwardedProto = req.headers['x-forwarded-proto'];
  const isHttps = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
    ?.split(',')[0]
    ?.trim()
    .startsWith('https');
  const cookie = [
    `${RETURNING_USER_COOKIE_NAME}=1`,
    `Max-Age=${RETURNING_USER_COOKIE_MAX_AGE_SECONDS}`,
    'Path=/',
    'SameSite=Lax',
    ...(isHttps ? ['Secure'] : []),
  ].join('; ');
  const existing = res.getHeader('Set-Cookie');
  const previous =
    existing === undefined ? [] : Array.isArray(existing) ? existing : [String(existing)];
  res.setHeader('Set-Cookie', [...previous, cookie]);
};
