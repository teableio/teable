import type { Prisma } from '@teable/db-main-prisma';
import { IS_TEMPLATE_HEADER, type IUserMeVo } from '@teable/openapi';
import type { Request } from 'express';
import { pick } from 'lodash';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';

export type IPickUserMe = Pick<
  Prisma.UserGetPayload<null>,
  'id' | 'name' | 'avatar' | 'phone' | 'email' | 'password' | 'notifyMeta' | 'isAdmin' | 'lang'
>;

export const pickUserMe = (user: IPickUserMe): IUserMeVo => {
  return {
    ...pick(user, 'id', 'name', 'phone', 'email', 'isAdmin', 'lang'),
    notifyMeta: typeof user.notifyMeta === 'object' ? user.notifyMeta : JSON.parse(user.notifyMeta),
    avatar:
      user.avatar && !user.avatar?.startsWith('http')
        ? getPublicFullStorageUrl(user.avatar)
        : user.avatar,
    hasPassword: user.password !== null,
  };
};

export const getTemplateHeader = (request: Request): string | undefined => {
  const templateHeader =
    request.headers[IS_TEMPLATE_HEADER.toLowerCase()] || request.headers[IS_TEMPLATE_HEADER];
  return typeof templateHeader === 'string' ? templateHeader : undefined;
};
