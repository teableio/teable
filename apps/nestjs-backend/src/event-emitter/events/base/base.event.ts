import { Event } from '@teable/core';
import type { ICreateBaseVo } from '@teable/openapi';
import { match } from 'ts-pattern';
import type { IEventContext } from '../core-event';
import { CoreEvent } from '../core-event';

type IBaseCreatePayload = { base: ICreateBaseVo };
type IBaseDeletePayload = { baseId: string };
type IBaseUpdatePayload = IBaseCreatePayload;

export class BaseCreateEvent extends CoreEvent<IBaseCreatePayload> {
  public readonly name = Event.BASE_CREATE;

  constructor(base: ICreateBaseVo, context: IEventContext) {
    super({ base }, context);
  }
}

export class BaseDeleteEvent extends CoreEvent<IBaseDeletePayload> {
  public readonly name = Event.BASE_DELETE;
  constructor(baseId: string, context: IEventContext) {
    super({ baseId }, context);
  }
}

export class BaseUpdateEvent extends CoreEvent<IBaseUpdatePayload> {
  public readonly name = Event.BASE_UPDATE;

  constructor(base: ICreateBaseVo, context: IEventContext) {
    super({ base }, context);
  }
}

export class BaseEventFactory {
  static create(
    name: string,
    payload: IBaseCreatePayload | IBaseDeletePayload | IBaseUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Event.BASE_CREATE, () => {
        const { base } = payload as IBaseCreatePayload;
        return new BaseCreateEvent(base, context);
      })
      .with(Event.BASE_DELETE, () => {
        const { baseId } = payload as IBaseDeletePayload;
        return new BaseDeleteEvent(baseId, context);
      })
      .with(Event.BASE_UPDATE, () => {
        const { base } = payload as IBaseUpdatePayload;
        return new BaseUpdateEvent(base, context);
      })
      .otherwise(() => null);
  }
}
