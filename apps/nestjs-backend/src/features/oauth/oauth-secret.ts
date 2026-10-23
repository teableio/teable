import { getRandomString } from '@teable/core';
import * as bcrypt from 'bcrypt';

/**
 * A new client secret: the plain value goes to the client once, only the hash
 * and the masked form (last 10 characters visible) are stored.
 */
export async function createOAuthSecret() {
  const secret = getRandomString(40).toLocaleLowerCase();
  const hashedSecret = await bcrypt.hash(secret, 10);
  const sensitivePart = secret.slice(0, -10);
  const maskedSecret = secret.slice(0).replace(sensitivePart, '*'.repeat(sensitivePart.length));
  return { secret, hashedSecret, maskedSecret };
}
