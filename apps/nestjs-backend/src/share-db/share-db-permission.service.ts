import { Injectable } from '@nestjs/common';
import { IdPrefix, type PermissionAction } from '@teable-group/core';
import { ClsService } from 'nestjs-cls';
import ShareDBClass from 'sharedb';
import { PermissionService } from '../features/auth/permission.service';
import type { IClsStore } from '../types/cls';
import { getAction, getPrefixAction } from './utils';
import { WsAuthService } from './ws-auth.service';

type IContextDecorator = 'useCls' | 'skipIfBackend';
// eslint-disable-next-line @typescript-eslint/naming-convention
export function ContextDecorator(...args: IContextDecorator[]): MethodDecorator {
  return (_target: unknown, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
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
      // If 'useCls' is specified, set up the CLS context
      if (args.includes('useCls')) {
        const clsService: ClsService<IClsStore> = (this as ShareDbPermissionService).clsService;
        await clsService.runWith(clsService.get(), async () => {
          try {
            clsService.set('user', context.agent.custom.user);
            await originalMethod.apply(this, [context, callback]);
          } catch (error) {
            callback(error);
          }
        });
        return;
      }
      // If 'useCls' is not specified, just call the original method
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
  | ShareDBClass.middleware.ReadSnapshotsContext;

@Injectable()
export class ShareDbPermissionService {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly wsAuthService: WsAuthService,
    readonly clsService: ClsService<IClsStore>
  ) {}

  private async clsRunWith(
    context: IAuthMiddleContext,
    callback: (err?: unknown) => void,
    error?: unknown
  ) {
    await this.clsService.runWith(this.clsService.get(), async () => {
      this.clsService.set('user', context.agent.custom.user);
      callback(error);
    });
  }

  @ContextDecorator('skipIfBackend')
  async authMiddleware(context: IAuthMiddleContext, callback: (err?: unknown) => void) {
    try {
      const { cookie } = context.agent.custom;
      const user = await this.wsAuthService.checkCookie(cookie);
      context.agent.custom.user = user;
      await this.clsRunWith(context, callback);
    } catch (error) {
      callback(error);
    }
  }

  private async runPermissionCheck(collection: string, permissionAction: PermissionAction) {
    const [docType, collectionId] = collection.split('_');
    try {
      if (docType === IdPrefix.Table) {
        await this.permissionService.checkPermissionByBaseId(collectionId, [permissionAction]);
      } else {
        await this.permissionService.checkPermissionByTableId(collectionId, [permissionAction]);
      }
    } catch (e) {
      return e;
    }
  }

  @ContextDecorator('skipIfBackend', 'useCls')
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
    const error = await this.runPermissionCheck(collection, `${prefixAction}|${action}`);
    callback(error);
  }

  @ContextDecorator('skipIfBackend', 'useCls')
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
    const error = await this.runPermissionCheck(context.collection, `${prefixAction}|read`);
    callback(error);
  }
}
