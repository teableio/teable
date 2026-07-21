import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { RecordCreated, isRecordCreatedEvent } from '../../domain/table/events/RecordCreated';
import {
  RecordsBatchCreated,
  type IRecordsBatchCreatedOrchestration,
} from '../../domain/table/events/RecordsBatchCreated';
import type { RecordFieldValueDTO } from '../../domain/table/events/RecordFieldValuesDTO';
import type { BatchRecordMutationResult } from '../../ports/TableRecordRepository';

export const mergeRecordFieldValues = (
  fieldValues: ReadonlyArray<RecordFieldValueDTO>,
  changedFields?: ReadonlyMap<string, unknown>
): ReadonlyArray<RecordFieldValueDTO> => {
  if (!changedFields || changedFields.size === 0) {
    return fieldValues;
  }

  const merged = new Map(fieldValues.map((fieldValue) => [fieldValue.fieldId, fieldValue.value]));
  for (const [fieldId, value] of changedFields) {
    merged.set(fieldId, value);
  }

  return [...merged.entries()].map(([fieldId, value]) => ({ fieldId, value }));
};

export const aggregateRecordCreatedEvents = (params: {
  events: ReadonlyArray<IDomainEvent>;
  mutationResult?: BatchRecordMutationResult;
  decoratedChangedFieldsByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  orchestration?: IRecordsBatchCreatedOrchestration;
  preserveEventOrder?: boolean;
}): ReadonlyArray<IDomainEvent> => {
  const recordCreatedEvents: RecordCreated[] = [];
  const otherEvents: IDomainEvent[] = [];

  for (const event of params.events) {
    if (!isRecordCreatedEvent(event)) {
      otherEvents.push(event);
      continue;
    }

    const recordId = event.recordId.toString();
    const changedFields = new Map<string, unknown>();
    for (const [fieldId, value] of params.decoratedChangedFieldsByRecord?.get(recordId) ?? []) {
      changedFields.set(fieldId, value);
    }
    for (const [fieldId, value] of params.mutationResult?.computedChangesByRecord?.get(recordId) ??
      []) {
      changedFields.set(fieldId, value);
    }

    recordCreatedEvents.push(
      RecordCreated.create({
        tableId: event.tableId,
        baseId: event.baseId,
        recordId: event.recordId,
        fieldValues: mergeRecordFieldValues(
          event.fieldValues,
          changedFields.size > 0 ? changedFields : undefined
        ),
        source: event.source,
      })
    );
  }

  let aggregatedRecordEvents: ReadonlyArray<IDomainEvent> = recordCreatedEvents;
  if (recordCreatedEvents.length > 1) {
    const firstRecordEvent = recordCreatedEvents[0]!;
    aggregatedRecordEvents = [
      RecordsBatchCreated.create({
        tableId: firstRecordEvent.tableId,
        baseId: firstRecordEvent.baseId,
        records: recordCreatedEvents.map((event) => ({
          recordId: event.recordId.toString(),
          fields: event.fieldValues,
          orders: params.mutationResult?.recordOrders?.get(event.recordId.toString()),
        })),
        source: firstRecordEvent.source,
        orchestration: params.orchestration,
      }),
    ];
  }

  if (!params.preserveEventOrder) {
    return [...aggregatedRecordEvents, ...otherEvents];
  }

  const orderedEvents: IDomainEvent[] = [];
  let recordEventsInserted = false;
  for (const event of params.events) {
    if (isRecordCreatedEvent(event)) {
      if (!recordEventsInserted) {
        orderedEvents.push(...aggregatedRecordEvents);
        recordEventsInserted = true;
      }
      continue;
    }
    orderedEvents.push(event);
  }
  return orderedEvents;
};
