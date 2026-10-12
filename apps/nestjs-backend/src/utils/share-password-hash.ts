import { createHash } from 'node:crypto';

/**
 * Share-password cookies are JWTs, and a JWT is signed, not encrypted: the
 * browser (and anything able to read the cookie) sees its payload. The cookie
 * therefore carries a hash bound to the share rather than the plaintext
 * password, so a leaked cookie cannot be read back into the password while a
 * password change still invalidates every cookie issued under the old one.
 */
export const hashSharePassword = (shareId: string, password: string) =>
  createHash('sha256').update(`${shareId}:${password}`).digest('hex');
