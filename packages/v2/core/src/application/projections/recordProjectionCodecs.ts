import { ok, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { RecordCreated } from '../../domain/table/events/RecordCreated';
import { RecordReordered } from '../../domain/table/events/RecordReordered';
import { RecordsBatchCreated } from '../../domain/table/events/RecordsBatchCreated';
import { RecordsBatchUpdated } from '../../domain/table/events/RecordsBatchUpdated';
import { RecordsDeleted } from '../../domain/table/events/RecordsDeleted';
import { RecordUpdated } from '../../domain/table/events/RecordUpdated';
import type { AbstractTableUpdatedEvent } from '../../domain/table/events/AbstractTableUpdatedEvent';
import type { EventType } from '../../ports/EventHandler';
import type { IProjectionMessageCodec, ProjectionMessageJson } from '../../ports/ProjectionMessage';

const jsonPayload = (value: unknown): ProjectionMessageJson => value as ProjectionMessageJson;

const MAX_DURABLE_CELL_JSON_CHARS = 256;

const compactCellValue = (value: unknown): unknown => {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length <= MAX_DURABLE_CELL_JSON_CHARS
      ? value
      : value.slice(0, MAX_DURABLE_CELL_JSON_CHARS);
  }
  try {
    const json = JSON.stringify(value);
    if (json.length <= MAX_DURABLE_CELL_JSON_CHARS) {
      return value;
    }
    return { truncated: true, bytes: json.length };
  } catch {
    return { truncated: true };
  }
};

const tableRoute = (event: AbstractTableUpdatedEvent) => ({
  transactionScope: 'data' as const,
  baseId: event.baseId.toString(),
  tableId: event.tableId.toString(),
});

const passThroughDecode = (
  payload: ProjectionMessageJson
): Result<ProjectionMessageJson, DomainError> => ok(payload);

export const recordCreatedProjectionCodec: IProjectionMessageCodec<RecordCreated> = {
  eventType: RecordCreated as EventType<RecordCreated>,
  messageName: 'table.record.created.v1',
  schemaVersion: 1,
  encode: (event) =>
    ok(
      jsonPayload({
        tableId: event.tableId.toString(),
        baseId: event.baseId.toString(),
        recordId: event.recordId.toString(),
        fieldValues: event.fieldValues,
        source: event.source,
      })
    ),
  decode: passThroughDecode,
  route: (event) => ({
    ...tableRoute(event),
    streamKey: event.recordId.toString(),
  }),
};

export const recordsBatchCreatedProjectionCodec: IProjectionMessageCodec<RecordsBatchCreated> = {
  eventType: RecordsBatchCreated as EventType<RecordsBatchCreated>,
  messageName: 'table.records.batch-created.v1',
  schemaVersion: 1,
  encode: (event) =>
    ok(
      jsonPayload({
        tableId: event.tableId.toString(),
        baseId: event.baseId.toString(),
        records: event.records.map((record) => ({
          recordId: record.recordId,
          fields: record.fields.map((field) => ({
            fieldId: field.fieldId,
            value: compactCellValue(field.value),
          })),
        })),
        source: event.source,
        orchestration: event.orchestration,
        auditSource: event.auditSource,
      })
    ),
  decode: passThroughDecode,
  route: (event) => ({
    ...tableRoute(event),
    operationId: event.orchestration?.operationId,
  }),
};

export const recordUpdatedProjectionCodec: IProjectionMessageCodec<RecordUpdated> = {
  eventType: RecordUpdated as EventType<RecordUpdated>,
  messageName: 'table.record.updated.v1',
  schemaVersion: 1,
  encode: (event) =>
    ok(
      jsonPayload({
        tableId: event.tableId.toString(),
        baseId: event.baseId.toString(),
        recordId: event.recordId.toString(),
        oldVersion: event.oldVersion,
        newVersion: event.newVersion,
        changes: event.changes,
        source: event.source,
      })
    ),
  decode: passThroughDecode,
  route: (event) => ({
    ...tableRoute(event),
    streamKey: event.recordId.toString(),
  }),
};

export const recordsBatchUpdatedProjectionCodec: IProjectionMessageCodec<RecordsBatchUpdated> = {
  eventType: RecordsBatchUpdated as EventType<RecordsBatchUpdated>,
  messageName: 'table.records.batch-updated.v1',
  schemaVersion: 1,
  encode: (event) =>
    ok(
      jsonPayload({
        tableId: event.tableId.toString(),
        baseId: event.baseId.toString(),
        updates: event.updates.map((update) => ({
          ...update,
          changes: update.changes.map((change) => ({
            ...change,
            oldValue: compactCellValue(change.oldValue),
            newValue: compactCellValue(change.newValue),
          })),
        })),
        source: event.source,
        orchestration: event.orchestration,
      })
    ),
  decode: passThroughDecode,
  route: (event) => ({
    ...tableRoute(event),
    operationId: event.orchestration?.operationId,
  }),
};

export const recordsDeletedProjectionCodec: IProjectionMessageCodec<RecordsDeleted> = {
  eventType: RecordsDeleted as EventType<RecordsDeleted>,
  messageName: 'table.records.deleted.v1',
  schemaVersion: 1,
  encode: (event) =>
    ok(
      jsonPayload({
        tableId: event.tableId.toString(),
        baseId: event.baseId.toString(),
        recordIds: event.recordIds.map((id) => id.toString()),
        orchestration: event.orchestration,
        removalReason: event.removalReason,
      })
    ),
  decode: passThroughDecode,
  route: (event) => ({
    ...tableRoute(event),
    operationId: event.orchestration?.operationId,
  }),
};

export const recordReorderedProjectionCodec: IProjectionMessageCodec<RecordReordered> = {
  eventType: RecordReordered as EventType<RecordReordered>,
  messageName: 'table.record.reordered.v1',
  schemaVersion: 1,
  encode: (event) =>
    ok(
      jsonPayload({
        tableId: event.tableId.toString(),
        baseId: event.baseId.toString(),
        viewId: event.viewId.toString(),
        recordIds: event.recordIds.map((id) => id.toString()),
        ordersByRecordId: event.ordersByRecordId,
        previousOrdersByRecordId: event.previousOrdersByRecordId,
      })
    ),
  decode: passThroughDecode,
  route: tableRoute,
};

export const recordProjectionCodecs: ReadonlyArray<IProjectionMessageCodec> = [
  recordCreatedProjectionCodec,
  recordsBatchCreatedProjectionCodec,
  recordUpdatedProjectionCodec,
  recordsBatchUpdatedProjectionCodec,
  recordsDeletedProjectionCodec,
  recordReorderedProjectionCodec,
];
