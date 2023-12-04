import { instanceToPlain } from 'class-transformer';
import type { IBaseEvent, IEventContext } from '../interfaces/base-event.interface';
import type { Events } from '../model';

export abstract class AbstractEvent implements IBaseEvent {
  abstract name: Events;

  abstract context: IEventContext;

  toJSON() {
    return instanceToPlain(this);
  }
}
