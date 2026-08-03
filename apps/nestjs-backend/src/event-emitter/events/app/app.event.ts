import { match } from 'ts-pattern';
import type { IEventContext } from '../core-event';
import { CoreEvent } from '../core-event';
import { Events } from '../event.enum';

interface IAppVo {
  id: string;
  name: string;
}

type IAppCreatePayload = { baseId: string; app: IAppVo };
type IAppDeletePayload = { baseId: string; appId: string; permanent?: boolean };
type IAppUpdatePayload = { baseId: string; app: IAppVo };

export class AppCreateEvent extends CoreEvent<IAppCreatePayload> {
  public readonly name = Events.APP_CREATE;

  constructor(payload: IAppCreatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class AppDeleteEvent extends CoreEvent<IAppDeletePayload> {
  public readonly name = Events.APP_DELETE;
  constructor(payload: IAppDeletePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class AppUpdateEvent extends CoreEvent<IAppUpdatePayload> {
  public readonly name = Events.APP_UPDATE;

  constructor(payload: IAppUpdatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class AppEventFactory {
  static create(
    name: string,
    payload: IAppCreatePayload | IAppDeletePayload | IAppUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.APP_CREATE, () => {
        const { baseId, app } = payload as IAppCreatePayload;
        return new AppCreateEvent({ baseId, app }, context);
      })
      .with(Events.APP_UPDATE, () => {
        const { baseId, app } = payload as IAppUpdatePayload;
        return new AppUpdateEvent({ baseId, app }, context);
      })
      .with(Events.APP_DELETE, () => {
        const { baseId, appId, permanent } = payload as IAppDeletePayload;
        return new AppDeleteEvent({ baseId, appId, permanent }, context);
      })
      .otherwise(() => null);
  }
}
