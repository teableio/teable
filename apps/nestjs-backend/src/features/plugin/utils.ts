import { getRandomString } from '@teable/core';
import * as bcrypt from 'bcrypt';

export const generateSecret = async (_secret?: string) => {
  const secret = _secret ?? getRandomString(40).toLocaleLowerCase();
  const hashedSecret = await bcrypt.hash(secret, 10);

  const sensitivePart = secret.slice(0, secret.length - 10);
  const maskedSecret = secret.slice(0).replace(sensitivePart, '*'.repeat(sensitivePart.length));
  return { secret, hashedSecret, maskedSecret };
};

export const validateSecret = async (secret: string, hashedSecret: string) => {
  return bcrypt.compare(secret, hashedSecret);
};
