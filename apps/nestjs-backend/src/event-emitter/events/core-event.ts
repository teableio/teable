import type { IncomingHttpHeaders } from 'http';
import type { OpName, Event } from '@teable/core';
import { nanoid } from 'nanoid';

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
  abstract name: Event;

  constructor(
    public readonly payload: Payload,
    public readonly context: IEventContext,
    public readonly isBulk = false,
    public readonly id = nanoid()
  ) {}
}
