import type { ICreateBaseVo } from '@teable/openapi';
import { match } from 'ts-pattern';
import type { IEventContext } from '../core-event';
import { CoreEvent } from '../core-event';
import { Events } from '../event.enum';

type IBaseCreatePayload = { base: ICreateBaseVo };
type IBaseDeletePayload = { baseId: string };
type IBaseUpdatePayload = IBaseCreatePayload;
type IBasePermissionUpdatePayload = { baseId: string };

export class BaseCreateEvent extends CoreEvent<IBaseCreatePayload> {
  public readonly name = Events.BASE_CREATE;

  constructor(base: ICreateBaseVo, context: IEventContext) {
    super({ base }, context);
  }
}

export class BaseDeleteEvent extends CoreEvent<IBaseDeletePayload> {
  public readonly name = Events.BASE_DELETE;
  constructor(baseId: string, context: IEventContext) {
    super({ baseId }, context);
  }
}

export class BaseUpdateEvent extends CoreEvent<IBaseUpdatePayload> {
  public readonly name = Events.BASE_UPDATE;

  constructor(base: ICreateBaseVo, context: IEventContext) {
    super({ base }, context);
  }
}

export class BasePermissionUpdateEvent extends CoreEvent<IBasePermissionUpdatePayload> {
  public readonly name = Events.BASE_PERMISSION_UPDATE;

  constructor(baseId: string, context: IEventContext) {
    super({ baseId }, context);
  }
}

export class BaseEventFactory {
  static create(
    name: string,
    payload: IBaseCreatePayload | IBaseDeletePayload | IBaseUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.BASE_CREATE, () => {
        const { base } = payload as IBaseCreatePayload;
        return new BaseCreateEvent(base, context);
      })
      .with(Events.BASE_DELETE, () => {
        const { baseId } = payload as IBaseDeletePayload;
        return new BaseDeleteEvent(baseId, context);
      })
      .with(Events.BASE_UPDATE, () => {
        const { base } = payload as IBaseUpdatePayload;
        return new BaseUpdateEvent(base, context);
      })
      .with(Events.BASE_PERMISSION_UPDATE, () => {
        const { baseId } = payload as IBasePermissionUpdatePayload;
        return new BasePermissionUpdateEvent(baseId, context);
      })
      .otherwise(() => null);
  }
}
