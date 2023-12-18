import { Expose } from 'class-transformer';
import type { RawOpType } from '../../../share-db/interface';
import type { IBaseEvent } from '../../interfaces/base-event.interface';
import { IEventContext } from '../../interfaces/base-event.interface';
import type { Events } from '../event.enum';

export type IChangeValue = {
  oldValue: unknown | undefined;
  newValue: unknown;
};

export class BaseOpEvent implements IBaseEvent {
  name!: Events;
  @Expose() rawOpType: RawOpType | undefined;
  @Expose() isBatch: boolean | undefined;
  @Expose() context: IEventContext;

  constructor(
    rawOpType: RawOpType | undefined,
    isBatch: boolean | undefined,
    context: IEventContext
  ) {
    this.rawOpType = rawOpType;
    this.isBatch = isBatch;
    this.context = context;
  }
}
