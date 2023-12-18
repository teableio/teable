import type { ICreateSpaceVo, IUpdateSpaceVo } from '@teable-group/openapi';
import type { IBaseEvent, IEventContext } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';

type IEventName = Extract<Events, Events.SPACE_CREATE | Events.SPACE_DELETE | Events.SPACE_UPDATE>;

export class SpaceCreateEvent implements IBaseEvent {
  name: IEventName = Events.SPACE_CREATE;
  context: IEventContext;
  space: ICreateSpaceVo;

  constructor(space: ICreateSpaceVo, context: IEventContext) {
    this.space = space;
    this.context = context;
  }
}

export class SpaceDeleteEvent implements IBaseEvent {
  name: IEventName = Events.SPACE_DELETE;
  context: IEventContext;
  spaceId: string;

  constructor(spaceId: string, context: IEventContext) {
    this.spaceId = spaceId;
    this.context = context;
  }
}

export class SpaceUpdateEvent implements IBaseEvent {
  name: IEventName = Events.SPACE_UPDATE;
  context: IEventContext;
  spaceId: string;
  space: IUpdateSpaceVo;

  constructor(spaceId: string, space: IUpdateSpaceVo, context: IEventContext) {
    this.spaceId = spaceId;
    this.space = space;
    this.context = context;
  }
}
