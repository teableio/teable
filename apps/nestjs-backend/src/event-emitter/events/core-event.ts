import type { IncomingHttpHeaders } from 'node:http';
import type { OpName } from '@teable/core';
import type { IUserInfoVo } from '@teable/openapi';
import type { IRecordRemovalReason, RecordInitiator } from '@teable/v2-core';
import { nanoid } from 'nanoid';
import type { Events } from './event.enum';

export interface IEventContext {
  /** Trusted server snapshot, never populated from submitted operation metadata. */
  recordInitiator?: RecordInitiator;
  occurredAt?: string;
  recordHistoryPersisted?: boolean;
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
  public readonly occurredAt: Date;

  constructor(
    public readonly payload: Payload,
    public readonly context: IEventContext,
    public readonly isBulk = false,
    public readonly id = nanoid()
  ) {
    this.context = {
      ...context,
      user: context.user ? { ...context.user } : undefined,
      recordInitiator: context.recordInitiator ? { ...context.recordInitiator } : undefined,
    };
    this.occurredAt = context.occurredAt ? new Date(context.occurredAt) : new Date();
  }
}
