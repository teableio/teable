import { match } from 'ts-pattern';
import type { IEventContext } from '../core-event';
import { CoreEvent } from '../core-event';
import { Events } from '../event.enum';

interface IRoutineVo {
  id: string;
  name: string;
}

type IRoutineCreatePayload = { baseId: string; routine: IRoutineVo };
// `routineId` mirrors the controller route param — the event interceptor builds
// this payload by spreading req params, so the name must match `:routineId`.
type IRoutineDeletePayload = { baseId: string; routineId: string; permanent?: boolean };
type IRoutineUpdatePayload = IRoutineCreatePayload;

export class RoutineCreateEvent extends CoreEvent<IRoutineCreatePayload> {
  public readonly name = Events.ROUTINE_CREATE;

  constructor(payload: IRoutineCreatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class RoutineDeleteEvent extends CoreEvent<IRoutineDeletePayload> {
  public readonly name = Events.ROUTINE_DELETE;

  constructor(payload: IRoutineDeletePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class RoutineUpdateEvent extends CoreEvent<IRoutineUpdatePayload> {
  public readonly name = Events.ROUTINE_UPDATE;

  constructor(payload: IRoutineUpdatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class RoutineEventFactory {
  static create(
    name: string,
    payload: IRoutineCreatePayload | IRoutineDeletePayload | IRoutineUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.ROUTINE_CREATE, () => {
        return new RoutineCreateEvent(payload as IRoutineCreatePayload, context);
      })
      .with(Events.ROUTINE_DELETE, () => {
        return new RoutineDeleteEvent(payload as IRoutineDeletePayload, context);
      })
      .with(Events.ROUTINE_UPDATE, () => {
        return new RoutineUpdateEvent(payload as IRoutineUpdatePayload, context);
      })
      .otherwise(() => null);
  }
}
