import { match } from 'ts-pattern';
import type { IEventContext } from '../core-event';
import { CoreEvent } from '../core-event';
import { Events } from '../event.enum';

interface IWorkflowVo {
  id: string;
  name: string;
}

type IWorkflowCreatePayload = { baseId: string; workflow: IWorkflowVo };
type IWorkflowDeletePayload = { baseId: string; workflowId: string };
type IWorkflowUpdatePayload = IWorkflowCreatePayload;

export class WorkflowCreateEvent extends CoreEvent<IWorkflowCreatePayload> {
  public readonly name = Events.WORKFLOW_CREATE;

  constructor(payload: IWorkflowCreatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class WorkflowDeleteEvent extends CoreEvent<IWorkflowDeletePayload> {
  public readonly name = Events.WORKFLOW_DELETE;
  constructor(payload: IWorkflowDeletePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class WorkflowUpdateEvent extends CoreEvent<IWorkflowUpdatePayload> {
  public readonly name = Events.WORKFLOW_UPDATE;

  constructor(payload: IWorkflowUpdatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class WorkflowEventFactory {
  static create(
    name: string,
    payload: IWorkflowCreatePayload | IWorkflowDeletePayload | IWorkflowUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.WORKFLOW_CREATE, () => {
        const { baseId, workflow } = payload as IWorkflowCreatePayload;
        return new WorkflowCreateEvent({ baseId, workflow }, context);
      })
      .with(Events.WORKFLOW_DELETE, () => {
        const { baseId, workflowId } = payload as IWorkflowDeletePayload;
        return new WorkflowDeleteEvent({ baseId, workflowId }, context);
      })
      .with(Events.WORKFLOW_UPDATE, () => {
        const { baseId, workflow } = payload as IWorkflowUpdatePayload;
        return new WorkflowUpdateEvent({ baseId, workflow }, context);
      })
      .otherwise(() => null);
  }
}
