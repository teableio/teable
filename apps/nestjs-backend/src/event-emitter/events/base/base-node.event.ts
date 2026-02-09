import { BaseNodeResourceType, type IBaseNodeVo, type IDeleteBaseNodeVo } from '@teable/openapi';
import { match } from 'ts-pattern';
import { AppEventFactory } from '../app/app.event';
import type { IEventContext } from '../core-event';
import { DashboardEventFactory } from '../dashboard/dashboard.event';
import { Events } from '../event.enum';
import { WorkflowEventFactory } from '../workflow/workflow.event';
import { BaseFolderEventFactory } from './folder/base.folder.event';

type IBaseNodeCreatePayload = { baseId: string; node: IBaseNodeVo };
type IBaseNodeDeletePayload = { baseId: string; node: IDeleteBaseNodeVo };
type IBaseNodeUpdatePayload = IBaseNodeCreatePayload;

// base node event to resource event(folder, dashboard, workflow, app); table event is handled by ops2Event;
export class BaseNodeEventFactory {
  static create(
    name: string,
    payload: IBaseNodeCreatePayload | IBaseNodeDeletePayload | IBaseNodeUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.BASE_NODE_CREATE, () => {
        const { baseId, node } = payload as IBaseNodeCreatePayload;
        const { resourceId, resourceType, resourceMeta } = node;
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
              },
              context
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
              },
              context
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
              },
              context
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
              },
              context
            );

          default:
            return null;
        }
      })
      .with(Events.BASE_NODE_UPDATE, () => {
        const { baseId, node } = payload as IBaseNodeUpdatePayload;
        const { resourceId, resourceType, resourceMeta } = node;
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
              },
              context
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
              },
              context
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
              },
              context
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
              },
              context
            );

          default:
            return null;
        }
      })
      .with(Events.BASE_NODE_DELETE, () => {
        const { baseId, node } = payload as IBaseNodeDeletePayload;
        const { resourceId, resourceType, permanent } = node;
        switch (resourceType) {
          case BaseNodeResourceType.Folder:
            return BaseFolderEventFactory.create(
              Events.BASE_FOLDER_DELETE,
              { baseId, folderId: resourceId },
              context
            );
          case BaseNodeResourceType.Dashboard:
            return DashboardEventFactory.create(
              Events.DASHBOARD_DELETE,
              { baseId, dashboardId: resourceId },
              context
            );
          case BaseNodeResourceType.Workflow:
            return WorkflowEventFactory.create(
              Events.WORKFLOW_DELETE,
              { baseId, workflowId: resourceId, permanent },
              context
            );
          case BaseNodeResourceType.App:
            return AppEventFactory.create(
              Events.APP_DELETE,
              { baseId, appId: resourceId, permanent },
              context
            );
          default:
            return null;
        }
      })

      .otherwise(() => null);
  }
}
