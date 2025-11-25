import { match } from 'ts-pattern';
import type { IEventContext } from '../core-event';
import { CoreEvent } from '../core-event';
import { Events } from '../event.enum';

interface IAppVo {
  id: string;
  name: string;
}

type IAppCreatePayload = { baseId: string; app: IAppVo };
type IAppDeletePayload = { baseId: string; appId: string };
type IAppUpdatePayload = { baseId: string; app: IAppVo };

export class AppCreateEvent extends CoreEvent<IAppCreatePayload> {
  public readonly name = Events.APP_CREATE;

  constructor(baseId: string, app: IAppVo, context: IEventContext) {
    super({ baseId, app }, context);
  }
}

export class AppDeleteEvent extends CoreEvent<IAppDeletePayload> {
  public readonly name = Events.APP_DELETE;
  constructor(baseId: string, appId: string, context: IEventContext) {
    super({ baseId, appId }, context);
  }
}

export class AppUpdateEvent extends CoreEvent<IAppUpdatePayload> {
  public readonly name = Events.APP_UPDATE;

  constructor(baseId: string, app: IAppVo, context: IEventContext) {
    super({ baseId, app }, context);
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
        return new AppCreateEvent(baseId, app, context);
      })
      .with(Events.APP_UPDATE, () => {
        const { baseId, app } = payload as IAppUpdatePayload;
        return new AppUpdateEvent(baseId, app, context);
      })
      .with(Events.APP_DELETE, () => {
        const { baseId, appId } = payload as IAppDeletePayload;
        return new AppDeleteEvent(baseId, appId, context);
      })
      .otherwise(() => null);
  }
}
