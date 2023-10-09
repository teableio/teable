import { HttpErrorCode } from '@teable-group/core';
import type ShareDBClass from 'sharedb';
import type { WsAuthService } from './ws-auth.service';

// eslint-disable-next-line @typescript-eslint/naming-convention
const UnauthorizedError = { message: 'Unauthorized', code: HttpErrorCode.UNAUTHORIZED };

export const checkCookie = async (cookie: string | undefined, wsAuthService: WsAuthService) => {
  if (cookie) {
    try {
      return await wsAuthService.auth(cookie);
    } catch {
      throw UnauthorizedError;
    }
  } else {
    throw UnauthorizedError;
  }
};

type IAuthMiddleContext =
  | ShareDBClass.middleware.ConnectContext
  | ShareDBClass.middleware.ApplyContext
  | ShareDBClass.middleware.ReadSnapshotsContext;

export const authMiddleware = (shareDB: ShareDBClass, wsAuthService: WsAuthService) => {
  const checkAuth = async (context: IAuthMiddleContext, callback: (err?: unknown) => void) => {
    const { isBackend, cookie } = context.agent.custom;
    if (isBackend) {
      return callback();
    }
    try {
      const user = await checkCookie(cookie, wsAuthService);
      context.agent.custom.user = user;
      callback();
    } catch (error) {
      callback(error);
    }
  };

  shareDB.use('connect', async (context, callback) => {
    if (!context.req) {
      context.agent.custom.isBackend = true;
      callback();
      return;
    }
    const cookie = context.req.headers.cookie;
    context.agent.custom.cookie = cookie;
    await checkAuth(context, callback);
  });

  shareDB.use('apply', checkAuth);

  shareDB.use('readSnapshots', checkAuth);
};
