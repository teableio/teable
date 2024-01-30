import type { IncomingHttpHeaders } from 'http';
import type { OpName } from '@teable-group/core';
import { nanoid } from 'nanoid';
import type { Events } from './event.enum';

export interface IEventContext {
  user?: {
    id: string;
    name: string;
    email: string;
  };
  headers?: Record<string, string | undefined> | IncomingHttpHeaders;
  opMeta?: {
    name: OpName;
    propertyKey?: string;
  };
}

export abstract class CoreEvent<Payload extends object = object> {
  abstract name: Events;

  constructor(
    public readonly payload: Payload,
    public readonly context: IEventContext,
    public readonly isBulk = false,
    public readonly id = nanoid()
  ) {}
}
