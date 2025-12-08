/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BaseNodeResourceType } from '@teable/openapi';
import type { IDeleteBaseNodeVo, IBaseNodeVo } from '@teable/openapi';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { match, P } from 'ts-pattern';
import { EMIT_EVENT_NAME } from '../decorators/emit-controller-event.decorator';
import { EventEmitterService } from '../event-emitter.service';
import type { IEventContext } from '../events';
import {
  Events,
  BaseEventFactory,
  SpaceEventFactory,
  DashboardEventFactory,
  AppEventFactory,
  WorkflowEventFactory,
  BaseFolderEventFactory,
} from '../events';

@Injectable()
export class EventMiddleware implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const emitEventName = this.reflector.get<Events>(EMIT_EVENT_NAME, context.getHandler());

    return next.handle().pipe(
      tap((data) => {
        const interceptContext = this.interceptContext(req, data);

        const event = this.createEvent(emitEventName, interceptContext);
        event
          ? this.eventEmitterService.emitAsync(event.name, event)
          : this.eventEmitterService.emitAsync(emitEventName, interceptContext);
      })
    );
  }

  private interceptContext(req: Request, resolveData: any) {
    return {
      reqUser: req?.user as any,
      reqHeaders: req?.headers,
      reqParams: req?.params,
      reqQuery: req?.query,
      reqBody: req?.body,
      resolveData,
    };
  }

  private createEvent(
    eventName: Events,
    interceptContext: ReturnType<typeof this.interceptContext>
  ) {
    const { reqUser, reqHeaders, reqParams, resolveData } = interceptContext;

    const eventContext: IEventContext = {
      user: reqUser,
      headers: reqHeaders,
    };

    return match(eventName)
      .with(Events.BASE_DELETE, () =>
        BaseEventFactory.create(eventName, { ...resolveData, ...reqParams }, eventContext)
      )
      .with(P.union(Events.BASE_CREATE, Events.BASE_UPDATE, Events.BASE_PERMISSION_UPDATE), () =>
        BaseEventFactory.create(eventName, { base: resolveData, ...reqParams }, eventContext)
      )
      .with(Events.SPACE_DELETE, () =>
        SpaceEventFactory.create(eventName, { ...resolveData, ...reqParams }, eventContext)
      )
      .with(P.union(Events.SPACE_CREATE, Events.SPACE_UPDATE), () =>
        SpaceEventFactory.create(eventName, { space: resolveData, ...reqParams }, eventContext)
      )
      .with(Events.WORKFLOW_DELETE, () =>
        WorkflowEventFactory.create(eventName, { ...resolveData, ...reqParams }, eventContext)
      )
      .with(P.union(Events.WORKFLOW_CREATE, Events.WORKFLOW_UPDATE), () =>
        WorkflowEventFactory.create(
          eventName,
          { baseId: reqParams.baseId, workflow: resolveData, ...reqParams },
          eventContext
        )
      )
      .with(Events.APP_DELETE, () =>
        AppEventFactory.create(eventName, { ...resolveData, ...reqParams }, eventContext)
      )
      .with(P.union(Events.APP_CREATE, Events.APP_UPDATE), () =>
        AppEventFactory.create(
          eventName,
          { baseId: reqParams.baseId, app: resolveData, ...reqParams },
          eventContext
        )
      )
      .with(Events.DASHBOARD_DELETE, () =>
        DashboardEventFactory.create(eventName, { ...resolveData, ...reqParams }, eventContext)
      )
      .with(P.union(Events.DASHBOARD_CREATE, Events.DASHBOARD_UPDATE), () =>
        DashboardEventFactory.create(
          eventName,
          { baseId: reqParams.baseId, dashboard: resolveData, ...reqParams },
          eventContext
        )
      )

      .with(Events.BASE_NODE_CREATE, () => {
        const { baseId } = reqParams;
        const { resourceId, resourceType, resourceMeta } = resolveData as IBaseNodeVo;
        switch (resourceType) {
          case BaseNodeResourceType.Folder:
            return BaseFolderEventFactory.create(
              Events.BASE_FOLDER_CREATE,
              {
                baseId,
                folder: {
                  id: resourceId,
                  ...resourceMeta,
                },
                ...reqParams,
              },
              eventContext
            );
          case BaseNodeResourceType.Dashboard:
            return DashboardEventFactory.create(
              Events.DASHBOARD_CREATE,
              {
                baseId,
                dashboard: {
                  id: resourceId,
                  ...resourceMeta,
                },
                ...reqParams,
              },
              eventContext
            );
          case BaseNodeResourceType.Workflow:
            return WorkflowEventFactory.create(
              Events.WORKFLOW_CREATE,
              {
                baseId,
                workflow: {
                  id: resourceId,
                  ...resourceMeta,
                },
                ...reqParams,
              },
              eventContext
            );
          case BaseNodeResourceType.App:
            return AppEventFactory.create(
              Events.APP_CREATE,
              {
                baseId,
                app: {
                  id: resourceId,
                  ...resourceMeta,
                },
                ...reqParams,
              },
              eventContext
            );

          default:
            return null;
        }
      })
      .with(Events.BASE_NODE_UPDATE, () => {
        const { baseId } = reqParams;
        const { resourceId, resourceType, resourceMeta } = resolveData as IBaseNodeVo;
        switch (resourceType) {
          case BaseNodeResourceType.Folder:
            return BaseFolderEventFactory.create(
              Events.BASE_FOLDER_UPDATE,
              {
                baseId,
                folder: {
                  id: resourceId,
                  ...resourceMeta,
                },
                ...reqParams,
              },
              eventContext
            );
          case BaseNodeResourceType.Dashboard:
            return DashboardEventFactory.create(
              Events.DASHBOARD_UPDATE,
              {
                baseId,
                dashboard: {
                  id: resourceId,
                  ...resourceMeta,
                },
                ...reqParams,
              },
              eventContext
            );
          case BaseNodeResourceType.Workflow:
            return WorkflowEventFactory.create(
              Events.WORKFLOW_UPDATE,
              {
                baseId,
                workflow: {
                  id: resourceId,
                  ...resourceMeta,
                },
                ...reqParams,
              },
              eventContext
            );
          case BaseNodeResourceType.App:
            return AppEventFactory.create(
              Events.APP_UPDATE,
              {
                baseId,
                app: {
                  id: resourceId,
                  ...resourceMeta,
                },
                ...reqParams,
              },
              eventContext
            );

          default:
            return null;
        }
      })
      .with(Events.BASE_NODE_DELETE, () => {
        const { baseId } = reqParams;
        const { resourceId, resourceType } = resolveData as IDeleteBaseNodeVo;
        switch (resourceType) {
          case BaseNodeResourceType.Folder:
            return BaseFolderEventFactory.create(
              Events.BASE_FOLDER_DELETE,
              { baseId, folderId: resourceId, ...reqParams },
              eventContext
            );
          case BaseNodeResourceType.Dashboard:
            return DashboardEventFactory.create(
              Events.DASHBOARD_DELETE,
              { baseId, dashboardId: resourceId, ...reqParams },
              eventContext
            );
          case BaseNodeResourceType.Workflow:
            return WorkflowEventFactory.create(
              Events.WORKFLOW_DELETE,
              { baseId, workflowId: resourceId, ...reqParams },
              eventContext
            );
          case BaseNodeResourceType.App:
            return AppEventFactory.create(
              Events.APP_DELETE,
              { baseId, appId: resourceId, ...reqParams },
              eventContext
            );

          default:
            return null;
        }
      })

      .otherwise(() => null);
  }
}
