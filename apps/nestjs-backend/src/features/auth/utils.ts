import type { Prisma } from '@teable/db-main-prisma';
import { UploadType, type IUserMeVo } from '@teable/openapi';
import { pick } from 'lodash';
import StorageAdapter from '../attachments/plugins/adapter';
import { getFullStorageUrl } from '../attachments/plugins/utils';

export const pickUserMe = (
  user: Pick<
    Prisma.UserGetPayload<null>,
    'id' | 'name' | 'avatar' | 'phone' | 'email' | 'password' | 'notifyMeta' | 'isAdmin'
  >
): IUserMeVo => {
  return {
    ...pick(user, 'id', 'name', 'phone', 'email', 'isAdmin'),
    notifyMeta: typeof user.notifyMeta === 'object' ? user.notifyMeta : JSON.parse(user.notifyMeta),
    avatar:
      user.avatar && !user.avatar?.startsWith('http')
        ? getFullStorageUrl(StorageAdapter.getBucket(UploadType.Avatar), user.avatar)
        : user.avatar,
    hasPassword: user.password !== null,
  };
};
