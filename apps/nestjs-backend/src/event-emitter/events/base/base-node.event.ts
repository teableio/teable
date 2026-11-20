import { BaseNodeResourceType, type IBaseNodeVo, type IDeleteBaseNodeVo } from '@teable/openapi';
import { match } from 'ts-pattern';
import { resourceDescriptorOf } from '../../../features/resource/resource-descriptor';
import { AppEventFactory } from '../app/app.event';
import type { CoreEvent, IEventContext } from '../core-event';
import { DashboardEventFactory } from '../dashboard/dashboard.event';
import { Events } from '../event.enum';
import { RoutineEventFactory } from '../routine/routine.event';
import { WorkflowEventFactory } from '../workflow/workflow.event';
import { BaseFolderEventFactory } from './folder/base.folder.event';

type IBaseNodeCreatePayload = { baseId: string; node: IBaseNodeVo };
type IBaseNodeDeletePayload = { baseId: string; node: IDeleteBaseNodeVo };
type IBaseNodeUpdatePayload = IBaseNodeCreatePayload;

/** The factory of each node kind's own events; a table's are raised from its ops instead. */
const NODE_EVENT_FACTORIES: Partial<
  Record<
    BaseNodeResourceType,
    { create(name: string, payload: never, context: IEventContext): CoreEvent | null }
  >
> = {
  [BaseNodeResourceType.Folder]: BaseFolderEventFactory,
  [BaseNodeResourceType.Dashboard]: DashboardEventFactory,
  [BaseNodeResourceType.Workflow]: WorkflowEventFactory,
  [BaseNodeResourceType.App]: AppEventFactory,
  [BaseNodeResourceType.Routine]: RoutineEventFactory,
};

// base node event to the resource's own event, named and shaped as its descriptor says
export class BaseNodeEventFactory {
  static create(
    name: string,
    payload: IBaseNodeCreatePayload | IBaseNodeDeletePayload | IBaseNodeUpdatePayload,
    context: IEventContext
  ): CoreEvent | null {
    const { baseId, node } = payload;
    const factory = NODE_EVENT_FACTORIES[node.resourceType as BaseNodeResourceType];
    const nodeEvents = resourceDescriptorOf(node.resourceType)?.nodeEvents;
    if (!factory || !nodeEvents) return null;
    const key = nodeEvents.payloadKey;
    const resource = (event: Events) => {
      const { resourceId, resourceMeta } = node as IBaseNodeVo;
      return factory.create(
        event,
        { baseId, [key]: { id: resourceId, ...resourceMeta } } as never,
        context
      );
    };
    return match(name)
      .with(Events.BASE_NODE_CREATE, () => resource(nodeEvents.create))
      .with(Events.BASE_NODE_UPDATE, () => resource(nodeEvents.update))
      .with(Events.BASE_NODE_DELETE, () => {
        const { resourceId, permanent } = node as IDeleteBaseNodeVo;
        return factory.create(
          nodeEvents.delete,
          { baseId, [`${key}Id`]: resourceId, permanent } as never,
          context
        );
      })
      .otherwise(() => null);
  }
}
