import type { Prisma } from '@teable/db-main-prisma';
import type { IUserMeVo } from '@teable/openapi';
import { pick } from 'lodash';
import { getFullStorageUrl } from '../../utils/full-storage-url';

export const pickUserMe = (
  user: Pick<
    Prisma.UserGetPayload<null>,
    'id' | 'name' | 'avatar' | 'phone' | 'email' | 'password' | 'notifyMeta'
  >
): IUserMeVo => {
  return {
    ...pick(user, 'id', 'name', 'phone', 'email'),
    notifyMeta: typeof user.notifyMeta === 'object' ? user.notifyMeta : JSON.parse(user.notifyMeta),
    avatar:
      user.avatar && !user.avatar?.startsWith('http')
        ? getFullStorageUrl(user.avatar)
        : user.avatar,
    hasPassword: user.password !== null,
  };
};
