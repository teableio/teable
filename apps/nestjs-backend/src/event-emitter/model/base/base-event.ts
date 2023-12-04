import type { ICreateBaseVo, IUpdateBaseVo } from '@teable-group/openapi';
import { AbstractEvent } from '../../abstract/event.abstract';
import type { IEventContext } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';

type IEventName = Extract<Events, Events.BASE_CREATE | Events.BASE_DELETE | Events.BASE_UPDATE>;

export class BaseCreateEvent extends AbstractEvent {
  name: IEventName = Events.BASE_CREATE;
  context: IEventContext;
  base: ICreateBaseVo;

  constructor(base: ICreateBaseVo, context: IEventContext) {
    super();
    this.base = base;
    this.context = context;
  }
}

export class BaseDeleteEvent extends AbstractEvent {
  name: IEventName = Events.BASE_DELETE;
  context: IEventContext;
  baseId: string;

  constructor(baseId: string, context: IEventContext) {
    super();
    this.baseId = baseId;
    this.context = context;
  }
}

export class BaseUpdateEvent extends AbstractEvent {
  name: IEventName = Events.BASE_UPDATE;
  context: IEventContext;
  baseId: string;
  base: IUpdateBaseVo;

  constructor(baseId: string, base: IUpdateBaseVo, context: IEventContext) {
    super();
    this.baseId = baseId;
    this.base = base;
    this.context = context;
  }
}
