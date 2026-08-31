import type { IncomingHttpHeaders } from 'http';
import type { OpName } from '@teable/core';
import type { IUserInfoVo } from '@teable/openapi';
import type { IRecordRemovalReason } from '@teable/v2-core';
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
  // 'archived' removals keep their attachments_table reference rows (the archive snapshot
  // still references the files and they must keep counting toward attachment usage).
  recordRemovalReason?: IRecordRemovalReason;
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
