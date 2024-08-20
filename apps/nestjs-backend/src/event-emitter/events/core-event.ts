import type { IncomingHttpHeaders } from 'http';
import type { OpName } from '@teable/core';
import type { IUserInfoVo } from '@teable/openapi';
import { nanoid } from 'nanoid';
import type { Events } from './event.enum';

export interface IEventContext {
  user?: {
    id: string;
    name: string;
    email: string;
  };
  entry?: {
    type: string;
    id: string;
  };
  headers?: Record<string, string | undefined> | IncomingHttpHeaders;
  opMeta?: {
    name: OpName;
    propertyKey?: string;
  };
}

export interface IEventRawContext {
  reqUser?: IUserInfoVo;
  reqHeaders: Record<string, unknown>;
  reqParams?: unknown;
  reqQuery?: unknown;
  reqBody?: unknown;
  resolveData: unknown;
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
