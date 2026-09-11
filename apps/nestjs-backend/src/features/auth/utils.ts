import type { Prisma } from '@teable/db-main-prisma';
import {
  IS_TEMPLATE_HEADER,
  BASE_SHARE_ID_HEADER,
  SHARE_VIEW_ID_HEADER,
  type IUserMeVo,
} from '@teable/openapi';
import type { Request } from 'express';
import { pick } from 'lodash';
import type { ISessionClient } from '../../types/session';
import { parseClientHeader } from '../../utils/client-header';
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

export const getBaseShareHeader = (request: Request): string | undefined => {
  const baseShareHeader =
    request.headers[BASE_SHARE_ID_HEADER.toLowerCase()] || request.headers[BASE_SHARE_ID_HEADER];
  return typeof baseShareHeader === 'string' ? baseShareHeader : undefined;
};

export const getShareViewHeader = (request: Request): string | undefined => {
  const shareViewHeader =
    request.headers[SHARE_VIEW_ID_HEADER.toLowerCase()] || request.headers[SHARE_VIEW_ID_HEADER];
  return typeof shareViewHeader === 'string' ? shareViewHeader : undefined;
};

/** A same-origin path (query and hash allowed): the only target a sign-in flow may redirect to. */
export const isValidRedirectPath = (path: string): boolean => {
  try {
    const base = 'http://placeholder.local';
    const url = new URL(path, base);
    return url.origin === base && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
};

/**
 * Session descriptor for sign-ins made by a first-party client (`X-Teable-Client`), so a
 * session can later be told apart from browser ones; undefined when the header is absent.
 */
export const describeSessionClient = (request: Request): ISessionClient | undefined => {
  const parsed = parseClientHeader(request.headers['x-teable-client']);
  if (!parsed) return undefined;
  const userAgent = request.headers['user-agent'];
  return {
    ...parsed,
    ...(typeof userAgent === 'string' && userAgent ? { userAgent: userAgent.slice(0, 300) } : {}),
    createdAt: new Date().toISOString(),
  };
};
