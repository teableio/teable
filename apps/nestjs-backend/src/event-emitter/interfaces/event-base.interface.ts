import type { IOpContextBase } from '@teable-group/core';
import type { EventEnums } from '../model';

export interface IEventBase {
  eventName: EventEnums;

  ops?: IOpContextBase[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toJSON(): Record<string, any>;
}
