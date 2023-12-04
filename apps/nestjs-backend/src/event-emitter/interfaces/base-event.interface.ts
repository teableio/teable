import type { User as UserModel } from '@teable-group/db-main-prisma';
import type { Events } from '../model';

export interface IEventContext {
  user?: UserModel;
  headers?: Record<string, string>;
}

export interface IBaseEvent {
  name: Events;

  context: IEventContext;

  toJSON(): Record<string, unknown>;
}
