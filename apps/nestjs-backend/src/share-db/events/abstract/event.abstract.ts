import type { IOpContextBase } from '@teable-group/core';
import { instanceToPlain } from 'class-transformer';
import type { EventEnums } from '../event.enum';
import type { IEventBase } from '../interfaces/event-base.interface';

export abstract class EventAbstract implements IEventBase {
  eventName!: EventEnums;

  ops?: IOpContextBase[];

  toJSON() {
    return instanceToPlain(this);
  }
}
