import type { OpName } from '@teable-group/core';
import type { User as UserModel } from '@teable-group/db-main-prisma';
import type { Events } from '../model';

export interface IEventContext {
  user?: UserModel;
  headers?: Record<string, string>;
  opName?: OpName;
  opPropertyKey?: string;
}

export interface IBaseEvent {
  name: Events;

  context: IEventContext;

  isBatch?: boolean;
}
