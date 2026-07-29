import type { ICreateBaseVo } from '@teable/openapi';
import { match } from 'ts-pattern';
import type { IEventContext } from '../core-event';
import { CoreEvent } from '../core-event';
import { Events } from '../event.enum';

type IBaseCreatePayload = { base: ICreateBaseVo };
type IBaseDeletePayload = { baseId: string; permanent?: boolean };
/**
 * An update route that returns nothing (reorder) only knows the base id, so the base here is
 * partial. `body` is what the caller asked for, which is the only legible form of a change the
 * resource itself does not spell out (a reorder stores an internal fractional index; the body
 * says "after this anchor").
 */
type IBaseUpdatePayload = {
  base: Pick<ICreateBaseVo, 'id'> & Partial<ICreateBaseVo>;
  body?: Record<string, unknown>;
};
type IBasePermissionUpdatePayload = { baseId: string };

export class BaseCreateEvent extends CoreEvent<IBaseCreatePayload> {
  public readonly name = Events.BASE_CREATE;

  constructor(base: ICreateBaseVo, context: IEventContext) {
    super({ base }, context);
  }
}

export class BaseDeleteEvent extends CoreEvent<IBaseDeletePayload> {
  public readonly name = Events.BASE_DELETE;
  constructor(payload: IBaseDeletePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class BaseUpdateEvent extends CoreEvent<IBaseUpdatePayload> {
  public readonly name = Events.BASE_UPDATE;

  constructor(
    base: IBaseUpdatePayload['base'],
    context: IEventContext,
    body?: Record<string, unknown>
  ) {
    super({ base, ...(body && Object.keys(body).length ? { body } : {}) }, context);
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
        const { baseId, permanent } = payload as IBaseDeletePayload;
        return new BaseDeleteEvent({ baseId, permanent }, context);
      })
      .with(Events.BASE_UPDATE, () => {
        const { base, body } = payload as IBaseUpdatePayload;
        return new BaseUpdateEvent(base, context, body);
      })
      .with(Events.BASE_PERMISSION_UPDATE, () => {
        const { baseId } = payload as IBasePermissionUpdatePayload;
        return new BasePermissionUpdateEvent(baseId, context);
      })
      .otherwise(() => null);
  }
}
