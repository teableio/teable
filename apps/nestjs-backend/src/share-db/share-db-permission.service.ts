import { Injectable } from '@nestjs/common';
import { ANONYMOUS_USER_ID } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import type ShareDBClass from 'sharedb';
import type { IClsStore } from '../types/cls';
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
        await clsService.runWith({ ...clsService.get() }, async () => {
          try {
            clsService.set('user', context.agent.custom.user);
            clsService.set('shareViewId', context.agent.custom.shareId);
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
  | ShareDBClass.middleware.ReadSnapshotsContext
  | ShareDBClass.middleware.QueryContext;

@Injectable()
export class ShareDbPermissionService {
  constructor(
    readonly clsService: ClsService<IClsStore>,
    private readonly wsAuthService: WsAuthService
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
      const { cookie, shareId, sessionId } = context.agent.custom;
      if (shareId) {
        context.agent.custom.user = { id: ANONYMOUS_USER_ID, name: ANONYMOUS_USER_ID, email: '' };
        await this.wsAuthService.checkShareCookie(shareId, cookie);
      } else {
        const user = await this.wsAuthService.checkSession(sessionId);
        context.agent.custom.user = user;
      }
      await this.clsRunWith(context, callback);
    } catch (error) {
      callback(error);
    }
  }
}
