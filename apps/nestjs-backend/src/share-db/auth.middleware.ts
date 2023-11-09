import type { PermissionAction } from '@teable-group/core';
import { ActionPrefix, HttpErrorCode, IdPrefix } from '@teable-group/core';
import type { ClsService } from 'nestjs-cls';
import type ShareDBClass from 'sharedb';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import type { PermissionService } from '../features/auth/permission.service';
import type { IClsStore } from '../types/cls';
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

const getPrefixAction = (docType: IdPrefix) => {
  switch (docType) {
    case IdPrefix.View:
      return ActionPrefix.View;
    case IdPrefix.Table:
      return ActionPrefix.Table;
    case IdPrefix.Record:
      return ActionPrefix.Record;
    case IdPrefix.Field:
      return ActionPrefix.Field;
    default:
      return null;
  }
};

const getAction = (op: CreateOp | DeleteOp | EditOp) => {
  if (op.create) {
    return 'create';
  }
  if (op.op) {
    return 'update';
  }
  if (op.del) {
    return 'delete';
  }
  return null;
};

type IAuthMiddleContext =
  | ShareDBClass.middleware.ConnectContext
  | ShareDBClass.middleware.ApplyContext
  | ShareDBClass.middleware.ReadSnapshotsContext;

export const authMiddleware = (
  shareDB: ShareDBClass,
  wsAuthService: WsAuthService,
  clsService: ClsService<IClsStore>,
  permissionService: PermissionService
) => {
  const checkAuth = async (context: IAuthMiddleContext, callback: (err?: unknown) => void) => {
    const { isBackend, cookie } = context.agent.custom;
    clsService.runWith(clsService.get(), async () => {
      if (isBackend) {
        return callback();
      }
      try {
        const user = await checkCookie(cookie, wsAuthService);
        context.agent.custom.user = user;
        clsService.set('user', user);
        callback();
      } catch (error) {
        callback(error);
      }
    });
  };

  const runPermissionCheck = async (
    context: ShareDBClass.middleware.ApplyContext | ShareDBClass.middleware.ReadSnapshotsContext,
    permissionAction: PermissionAction,
    callback: (err?: unknown) => void
  ) => {
    try {
      const [docType, collectionId] = context.collection.split('_');
      const { isBackend } = context.agent.custom;
      await clsService.runWith(clsService.get(), async () => {
        if (isBackend) {
          return callback();
        }
        clsService.set('user', context.agent.custom.user);

        if (docType === IdPrefix.Table) {
          await permissionService.checkPermissionByBaseId(collectionId, [permissionAction]);
        } else {
          await permissionService.checkPermissionByTableId(collectionId, [permissionAction]);
        }
      });
      callback();
    } catch (e) {
      callback(e);
    }
  };

  const checkApplyPermission = async (
    context: ShareDBClass.middleware.ApplyContext,
    callback: (err?: unknown) => void
  ) => {
    const { id: docId, op } = context;
    const [docType] = context.collection.split('_');
    const prefixAction = getPrefixAction(docType as IdPrefix);
    const action = getAction(op);
    if (!prefixAction || !action) {
      callback(`doc(${docId}) not allowed`);
      return;
    }
    await runPermissionCheck(context, `${prefixAction}|${action}`, callback);
  };

  const checkReadPermission = async (
    context: ShareDBClass.middleware.ReadSnapshotsContext,
    callback: (err?: unknown) => void
  ) => {
    const [docType] = context.collection.split('_');
    const prefixAction = getPrefixAction(docType as IdPrefix);
    if (!prefixAction) {
      callback(`doc(${context.action}) not allowed`);
      return;
    }
    await runPermissionCheck(context, `${prefixAction}|read`, callback);
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
  shareDB.use('apply', checkApplyPermission);

  shareDB.use('readSnapshots', checkAuth);
  shareDB.use('readSnapshots', checkReadPermission);
};
