import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { MOBILE_AUTH_CODE_CHALLENGE_RE, MOBILE_AUTH_CODE_VERIFIER_RE } from '@teable/openapi';

/** RFC 7636 S256: base64url(SHA-256(verifier)). */
export const sha256Base64url = (input: string): string =>
  createHash('sha256').update(input).digest('base64url');

/** Constant-time S256 check; malformed inputs never verify. */
export const verifyS256 = (codeVerifier: string, codeChallenge: string): boolean => {
  if (
    !MOBILE_AUTH_CODE_VERIFIER_RE.test(codeVerifier) ||
    !MOBILE_AUTH_CODE_CHALLENGE_RE.test(codeChallenge)
  ) {
    return false;
  }
  const expected = Buffer.from(sha256Base64url(codeVerifier));
  const actual = Buffer.from(codeChallenge);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

/** 256 bits of randomness, URL-safe. */
export const randomCode = (): string => randomBytes(32).toString('base64url');

/** Codes are cached under their hash so a cache dump cannot be replayed. */
export const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');
