import type { ICreateSpaceVo } from '@teable/openapi';
import { match } from 'ts-pattern';
import type { IEventContext } from '../core-event';
import { CoreEvent } from '../core-event';
import { Events } from '../event.enum';

type ISpaceCreatePayload = { space: ICreateSpaceVo };
type ISpaceDeletePayload = { spaceId: string };
type ISpaceUpdatePayload = ISpaceCreatePayload;

export class SpaceCreateEvent extends CoreEvent<ISpaceCreatePayload> {
  public readonly name = Events.SPACE_CREATE;

  constructor(space: ICreateSpaceVo, context: IEventContext) {
    super({ space }, context);
  }
}

export class SpaceDeleteEvent extends CoreEvent<ISpaceDeletePayload> {
  public readonly name = Events.SPACE_DELETE;

  constructor(spaceId: string, context: IEventContext) {
    super({ spaceId }, context);
  }
}

export class SpaceUpdateEvent extends CoreEvent<ISpaceUpdatePayload> {
  public readonly name = Events.SPACE_UPDATE;

  constructor(space: ICreateSpaceVo, context: IEventContext) {
    super({ space }, context);
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
        const { spaceId } = payload as ISpaceDeletePayload;
        return new SpaceDeleteEvent(spaceId, context);
      })
      .with(Events.SPACE_UPDATE, () => {
        const { space } = payload as ISpaceUpdatePayload;
        return new SpaceUpdateEvent(space, context);
      })
      .otherwise(() => null);
  }
}
