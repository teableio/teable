import { Injectable } from '@nestjs/common';
import { ANONYMOUS_USER_ID, IdPrefix } from '@teable-group/core';
import type { IShareViewMeta, PermissionAction } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import ShareDBClass from 'sharedb';
import { PermissionService } from '../features/auth/permission.service';
import { FieldService } from '../features/field/field.service';
import type { IClsStore } from '../types/cls';
import { getAction, getPrefixAction, isShareViewResourceDoc } from './utils';
import { WsAuthService } from './ws-auth.service';

type IContextDecorator = 'skipIfBackend';
// eslint-disable-next-line @typescript-eslint/naming-convention
export function ContextDecorator(...args: IContextDecorator[]): MethodDecorator {
  return function (
    _target: unknown,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (
      context: IAuthMiddleContext,
      callback: (err?: unknown) => void
    ) {
      // Skip if the context is from the backend
      if (args.includes('skipIfBackend') && context.agent.custom.isBackend) {
        callback();
        return;
      }
      try {
        await originalMethod.apply(this, [context, callback]);
      } catch (error) {
        callback(error);
      }
    };
  };
}

export type IAuthMiddleContext =
  | ShareDBClass.middleware.ConnectContext
  | ShareDBClass.middleware.ApplyContext
  | ShareDBClass.middleware.ReadSnapshotsContext
  | ShareDBClass.middleware.QueryContext;

@Injectable()
export class ShareDbPermissionService {
  constructor(
    readonly clsService: ClsService<IClsStore>,
    private readonly permissionService: PermissionService,
    private readonly wsAuthService: WsAuthService,
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService
  ) {}

  private async clsRunWith(
    context: IAuthMiddleContext,
    callback: (err?: unknown) => void,
    error?: unknown
  ) {
    await this.clsService.runWith(this.clsService.get(), async () => {
      this.clsService.set('user', context.agent.custom.user);
      this.clsService.set('shareViewId', context.agent.custom.shareId);
      callback(error);
    });
  }

  @ContextDecorator('skipIfBackend')
  async authMiddleware(context: IAuthMiddleContext, callback: (err?: unknown) => void) {
    try {
      const { cookie, shareId } = context.agent.custom;
      if (shareId) {
        context.agent.custom.user = { id: ANONYMOUS_USER_ID, name: ANONYMOUS_USER_ID, email: '' };
        await this.wsAuthService.checkShareCookie(shareId, cookie);
      } else {
        const user = await this.wsAuthService.checkCookie(cookie);
        context.agent.custom.user = user;
      }
      await this.clsRunWith(context, callback);
    } catch (error) {
      callback(error);
    }
  }

  private async runPermissionCheck(
    context: ShareDBClass.middleware.ApplyContext | ShareDBClass.middleware.ReadSnapshotsContext,
    permissionAction: PermissionAction
  ) {
    const { collection } = context;
    const [docType, collectionId] = collection.split('_');
    return await this.clsService.runWith(this.clsService.get(), async () => {
      this.clsService.set('user', { ...context.agent.custom.user });
      this.clsService.set('shareViewId', context.agent.custom.shareId);
      try {
        if (docType === IdPrefix.Table) {
          await this.permissionService.checkPermissionByBaseId(collectionId, [permissionAction]);
        } else {
          await this.permissionService.checkPermissionByTableId(collectionId, [permissionAction]);
        }
      } catch (e) {
        return e;
      }
    });
  }

  @ContextDecorator('skipIfBackend')
  async checkApplyPermissionMiddleware(
    context: ShareDBClass.middleware.ApplyContext,
    callback: (err?: unknown) => void
  ) {
    const { op, collection } = context;
    const [docType] = collection.split('_');
    const prefixAction = getPrefixAction(docType as IdPrefix);
    const action = getAction(op);
    if (!prefixAction || !action) {
      callback(`unknown docType: ${docType}`);
      return;
    }
    const error = await this.runPermissionCheck(context, `${prefixAction}|${action}`);
    await this.clsRunWith(context, callback, error);
  }

  @ContextDecorator('skipIfBackend')
  async checkReadPermissionMiddleware(
    context: ShareDBClass.middleware.ReadSnapshotsContext,
    callback: (err?: unknown) => void
  ) {
    const [docType] = context.collection.split('_');
    const prefixAction = getPrefixAction(docType as IdPrefix);
    if (!prefixAction) {
      callback(`unknown docType: ${docType}`);
      return;
    }
    // view share permission validation
    const shareId = context.agent.custom.shareId;
    if (shareId && isShareViewResourceDoc(docType as IdPrefix)) {
      const error = await this.checkReadViewSharePermission(
        shareId,
        context.collection,
        context.snapshots
      );
      await this.clsRunWith(context, callback, error);
      return;
    }
    const error = await this.runPermissionCheck(context, `${prefixAction}|read`);
    await this.clsRunWith(context, callback, error);
  }

  async checkReadViewSharePermission(
    shareId: string,
    collection: string,
    snapshots: ShareDBClass.Snapshot[]
  ) {
    const [docType, tableId] = collection.split('_');
    const view = await this.prismaService.txClient().view.findFirst({
      where: { shareId, tableId, deletedTime: null, enableShare: true },
    });
    if (!view) {
      return `invalid shareId: ${shareId}`;
    }
    const shareMeta = (JSON.parse(view.shareMeta as string) as IShareViewMeta) || {};
    const checkSnapshot = (checkSnapshotMethod: (snapshot: ShareDBClass.Snapshot) => boolean) =>
      snapshots.every(checkSnapshotMethod);

    // share view resource (field, view in share)
    switch (docType as IdPrefix) {
      case IdPrefix.Field:
        {
          const { ids } = await this.fieldService.getDocIdsByQuery(tableId, {
            viewId: view.id,
            filterHidden: !shareMeta.includeHiddenField,
          });
          const fieldIds = new Set(ids);
          if (!checkSnapshot((snapshot) => fieldIds.has(snapshot.id)))
            return 'no permission read field';
        }
        break;
      case IdPrefix.View:
        {
          if (!checkSnapshot((snapshot) => view.id === snapshot.id))
            return 'no permission read view';
        }
        break;
      case IdPrefix.Record:
        return;
      default:
        return 'unknown docType for read permission check';
    }
  }
}
