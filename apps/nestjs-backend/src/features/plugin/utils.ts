import { getRandomString } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PluginStatus } from '@teable/openapi';
import * as bcrypt from 'bcrypt';

export const generateSecret = async (_secret?: string) => {
  const secret = _secret ?? getRandomString(40).toLocaleLowerCase();
  const hashedSecret = await bcrypt.hash(secret, 10);

  const sensitivePart = secret.slice(0, -10);
  const maskedSecret = secret.slice(0).replace(sensitivePart, '*'.repeat(sensitivePart.length));
  return { secret, hashedSecret, maskedSecret };
};

export const validateSecret = async (secret: string, hashedSecret: string) => {
  return bcrypt.compare(secret, hashedSecret);
};

/**
 * Only a published plugin, or one its author is still developing, may be
 * installed. Installing seats the plugin's system user in the base, so an
 * arbitrary unpublished plugin must not be installable by anyone but its author.
 */
export const installablePluginWhere = (userId: string): Prisma.PluginWhereInput => ({
  OR: [
    { status: PluginStatus.Published },
    { status: { not: PluginStatus.Published }, createdBy: userId },
  ],
});
