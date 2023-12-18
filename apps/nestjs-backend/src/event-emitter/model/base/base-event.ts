import type { ICreateBaseVo, IUpdateBaseVo } from '@teable-group/openapi';
import type { IEventContext, IBaseEvent } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';

type IEventName = Extract<Events, Events.BASE_CREATE | Events.BASE_DELETE | Events.BASE_UPDATE>;

export class BaseCreateEvent implements IBaseEvent {
  name: IEventName = Events.BASE_CREATE;
  context: IEventContext;
  base: ICreateBaseVo;

  constructor(base: ICreateBaseVo, context: IEventContext) {
    this.base = base;
    this.context = context;
  }
}

export class BaseDeleteEvent implements IBaseEvent {
  name: IEventName = Events.BASE_DELETE;
  context: IEventContext;
  baseId: string;

  constructor(baseId: string, context: IEventContext) {
    this.baseId = baseId;
    this.context = context;
  }
}

export class BaseUpdateEvent implements IBaseEvent {
  name: IEventName = Events.BASE_UPDATE;
  context: IEventContext;
  baseId: string;
  base: IUpdateBaseVo;

  constructor(baseId: string, base: IUpdateBaseVo, context: IEventContext) {
    this.baseId = baseId;
    this.base = base;
    this.context = context;
  }
}
