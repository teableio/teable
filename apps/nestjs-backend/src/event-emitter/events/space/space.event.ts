import type { ICreateSpaceVo } from '@teable/openapi';
import { match } from 'ts-pattern';
import type { IEventContext } from '../core-event';
import { CoreEvent } from '../core-event';
import { Events } from '../event.enum';

type ISpaceCreatePayload = { space: ICreateSpaceVo };
type ISpaceDeletePayload = { spaceId: string; permanent?: boolean };
/**
 * The space is partial because an update route need not resolve to one — the id then comes from
 * the route param. `body` is what the caller asked for, kept by consumers only when the resolved
 * space does not already say it.
 */
type ISpaceUpdatePayload = {
  space: Pick<ICreateSpaceVo, 'id'> & Partial<ICreateSpaceVo>;
  body?: Record<string, unknown>;
};

export class SpaceCreateEvent extends CoreEvent<ISpaceCreatePayload> {
  public readonly name = Events.SPACE_CREATE;

  constructor(space: ICreateSpaceVo, context: IEventContext) {
    super({ space }, context);
  }
}

export class SpaceDeleteEvent extends CoreEvent<ISpaceDeletePayload> {
  public readonly name = Events.SPACE_DELETE;

  constructor(payload: ISpaceDeletePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class SpaceUpdateEvent extends CoreEvent<ISpaceUpdatePayload> {
  public readonly name = Events.SPACE_UPDATE;

  constructor(
    space: ISpaceUpdatePayload['space'],
    context: IEventContext,
    body?: Record<string, unknown>
  ) {
    super({ space, ...(body && Object.keys(body).length ? { body } : {}) }, context);
  }
}

export class SpaceEventFactory {
  static create(
    name: string,
    payload: ISpaceCreatePayload | ISpaceDeletePayload | ISpaceUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.SPACE_CREATE, () => {
        const { space } = payload as ISpaceCreatePayload;
        return new SpaceCreateEvent(space, context);
      })
      .with(Events.SPACE_DELETE, () => {
        const { spaceId, permanent } = payload as ISpaceDeletePayload;
        return new SpaceDeleteEvent({ spaceId, permanent }, context);
      })
      .with(Events.SPACE_UPDATE, () => {
        const { space, body } = payload as ISpaceUpdatePayload;
        return new SpaceUpdateEvent(space, context, body);
      })
      .otherwise(() => null);
  }
}
