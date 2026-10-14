import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { IEventRawContext, Events } from '../../event-emitter/events';
import { IDeleteRecordsPayload } from '../undo-redo/operations/delete-records.operation';
import { IUpdateRecordsPayload } from '../undo-redo/operations/update-records.operation';
import {
  SSA_EVENT_VERSION,
  SSA_MAX_CELL_CONTEXTS,
  SSA_MAX_SAMPLE_RECORDS,
  SsaEventForwarder,
} from './ssa-event-forwarder';
import type { ISsaRecordEvent, ISsaSampleRecord } from './ssa-event-forwarder';

export {
  SSA_MAX_CELL_CONTEXTS,
  SSA_MAX_SAMPLE_RECORDS,
  signSsaPayload,
} from './ssa-event-forwarder';

interface IForwardOptions {
  sampleRecords?: boolean;
  timestamp?: string;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const sampleRecords = (
  records: unknown[],
  includeRecords: boolean
): { records?: ISsaSampleRecord[]; recordIds: string[]; truncated: boolean } => {
  const recordIds: string[] = [];
  const samples: ISsaSampleRecord[] = [];

  for (const record of records) {
    if (!record || typeof record !== 'object') {
      continue;
    }
    const { id, fields } = record as { id?: unknown; fields?: unknown };
    const recordId = asString(id);
    if (!recordId) {
      continue;
    }
    recordIds.push(recordId);
    if (includeRecords && samples.length < SSA_MAX_SAMPLE_RECORDS) {
      samples.push({ id: recordId, fields: (fields as Record<string, unknown>) ?? {} });
    }
  }

  return {
    recordIds,
    records: samples.length ? samples : undefined,
    truncated: includeRecords && recordIds.length > SSA_MAX_SAMPLE_RECORDS,
  };
};

const baseEvent = (
  options: IForwardOptions,
  fields: Pick<ISsaRecordEvent, 'event' | 'tableId' | 'recordIds'> &
    Partial<Pick<ISsaRecordEvent, 'records' | 'changes' | 'truncated' | 'isBulk' | 'user'>>
): ISsaRecordEvent => ({
  version: SSA_EVENT_VERSION,
  event: fields.event,
  tableId: fields.tableId,
  recordIds: fields.recordIds,
  recordCount: fields.recordIds.length,
  isBulk: fields.isBulk ?? fields.recordIds.length > 1,
  truncated: fields.truncated ?? false,
  user: fields.user,
  timestamp: options.timestamp ?? new Date().toISOString(),
  ...(fields.records ? { records: fields.records } : {}),
  ...(fields.changes ? { changes: fields.changes } : {}),
});

/**
 * `operation.records.create` fires from the controller interceptor with the raw
 * request context; `resolveData` carries the created record snapshots. This
 * event fires for both v1 and v2 write paths (the interceptor is
 * transport-level), so it is only emitted once per operation.
 */
export const buildCreateEvent = (
  context: IEventRawContext,
  options: IForwardOptions = {}
): ISsaRecordEvent => {
  const resolveData = (context?.resolveData ?? {}) as { records?: unknown[] };
  const { records, recordIds, truncated } = sampleRecords(
    resolveData.records ?? [],
    options.sampleRecords ?? true
  );
  const tableId =
    asString((context?.reqParams as Record<string, unknown> | undefined)?.tableId) ?? '';
  const reqUser = context?.reqUser as { id?: string; name?: string; email?: string } | undefined;

  return baseEvent(options, {
    event: 'record.created',
    tableId,
    recordIds,
    truncated,
    isBulk: recordIds.length > 1,
    user: reqUser?.id ? { id: reqUser.id, name: reqUser.name, email: reqUser.email } : undefined,
    records,
  });
};

/**
 * `operation.records.update` fires post-commit from the record update service
 * for v1 write paths (only when the caller supplied a window id — app UI edits).
 */
export const buildUpdateEvent = (
  payload: IUpdateRecordsPayload,
  options: IForwardOptions = {}
): ISsaRecordEvent => {
  const includeChanges = options.sampleRecords ?? true;
  const cellContexts = includeChanges
    ? (payload?.cellContexts ?? []).slice(0, SSA_MAX_CELL_CONTEXTS)
    : undefined;
  const recordIds = payload?.recordIds ?? [];

  return baseEvent(options, {
    event: 'record.updated',
    tableId: payload?.tableId ?? '',
    recordIds,
    truncated: includeChanges && (payload?.cellContexts?.length ?? 0) > SSA_MAX_CELL_CONTEXTS,
    user: payload?.userId ? { id: payload.userId } : undefined,
    changes: {
      fieldIds: payload?.fieldIds ?? [],
      ...(cellContexts ? { cellContexts } : {}),
    },
  });
};

/**
 * `operation.records.delete` fires post-commit for v1 write paths with the
 * deleted snapshots.
 */
export const buildDeleteEvent = (
  payload: IDeleteRecordsPayload,
  options: IForwardOptions = {}
): ISsaRecordEvent => {
  const { records, recordIds, truncated } = sampleRecords(
    payload?.records ?? [],
    options.sampleRecords ?? true
  );

  return baseEvent(options, {
    event: 'record.deleted',
    tableId: payload?.tableId ?? '',
    recordIds,
    truncated,
    user: payload?.userId ? { id: payload.userId } : undefined,
    records,
  });
};

/**
 * V1 write-path listeners. Complements `ssa-v2-projections.ts`, which covers
 * the V2 domain-event path (the default for new bases) — duplicate emissions
 * are suppressed by the forwarder's short-window body dedupe.
 */
@Injectable()
export class SsaEventsListener {
  constructor(private readonly forwarder: SsaEventForwarder) {}

  @OnEvent(Events.OPERATION_RECORDS_CREATE, { async: true })
  async onRecordsCreated(context: IEventRawContext): Promise<void> {
    await this.forwarder.forward(buildCreateEvent(context));
  }

  @OnEvent(Events.OPERATION_RECORDS_UPDATE, { async: true })
  async onRecordsUpdated(payload: IUpdateRecordsPayload): Promise<void> {
    await this.forwarder.forward(buildUpdateEvent(payload));
  }

  @OnEvent(Events.OPERATION_RECORDS_DELETE, { async: true })
  async onRecordsDeleted(payload: IDeleteRecordsPayload): Promise<void> {
    await this.forwarder.forward(buildDeleteEvent(payload));
  }
}
