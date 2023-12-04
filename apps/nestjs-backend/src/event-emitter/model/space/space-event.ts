import type { ICreateSpaceVo, IUpdateSpaceVo } from '@teable-group/openapi';
import { AbstractEvent } from '../../abstract/event.abstract';
import type { IEventContext } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';

type IEventName = Extract<Events, Events.SPACE_CREATE | Events.SPACE_DELETE | Events.SPACE_UPDATE>;

export class SpaceCreateEvent extends AbstractEvent {
  name: IEventName = Events.SPACE_CREATE;
  context: IEventContext;
  space: ICreateSpaceVo;

  constructor(space: ICreateSpaceVo, context: IEventContext) {
    super();
    this.space = space;
    this.context = context;
  }
}

export class SpaceDeleteEvent extends AbstractEvent {
  name: IEventName = Events.SPACE_DELETE;
  context: IEventContext;
  spaceId: string;

  constructor(spaceId: string, context: IEventContext) {
    super();
    this.spaceId = spaceId;
    this.context = context;
  }
}

export class SpaceUpdateEvent extends AbstractEvent {
  name: IEventName = Events.SPACE_UPDATE;
  context: IEventContext;
  spaceId: string;
  space: IUpdateSpaceVo;

  constructor(spaceId: string, space: IUpdateSpaceVo, context: IEventContext) {
    super();
    this.spaceId = spaceId;
    this.space = space;
    this.context = context;
  }
}
