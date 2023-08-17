import type { IOpContextBase } from '@teable-group/core';
import { instanceToPlain } from 'class-transformer';
import type { IEventBase } from '../interfaces/event-base.interface';
import type { EventEnums } from '../model/event.enum';

export abstract class EventAbstract implements IEventBase {
  eventName!: EventEnums;

  ops?: IOpContextBase[];

  toJSON() {
    return instanceToPlain(this);
  }
}
