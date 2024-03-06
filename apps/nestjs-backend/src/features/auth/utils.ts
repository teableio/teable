import type { Prisma } from '@teable/db-main-prisma';
import { pick } from 'lodash';

export const pickUserMe = (user: Partial<Prisma.UserGetPayload<null>>) => {
  return pick(user, 'id', 'name', 'avatar', 'phone', 'email', 'notifyMeta');
};
