import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import {
  isRecordsBatchCreatedEvent,
  RecordsBatchCreated,
} from '../../domain/table/events/RecordsBatchCreated';

/** Counts only metadata while the request-owned spool holds complete record snapshots. */
export class ImportRecordBatchTotals {
  private readonly totals = new Map<
    string,
    { totalRecordCount: number; totalChunkCount: number }
  >();

  observe(events: ReadonlyArray<IDomainEvent>): void {
    for (const event of events) {
      const key = this.key(event);
      if (key === undefined || !isRecordsBatchCreatedEvent(event)) continue;
      const total = this.totals.get(key) ?? { totalRecordCount: 0, totalChunkCount: 0 };
      total.totalRecordCount += event.records.length;
      total.totalChunkCount++;
      this.totals.set(key, total);
    }
  }

  finalize(event: IDomainEvent): IDomainEvent {
    const key = this.key(event);
    if (key === undefined || !isRecordsBatchCreatedEvent(event) || !event.orchestration)
      return event;
    const total = this.totals.get(key);
    if (!total) return event;
    const finalized = RecordsBatchCreated.create({
      baseId: event.baseId,
      tableId: event.tableId,
      records: event.records,
      source: event.source,
      auditSource: event.auditSource,
      orchestration: { ...event.orchestration, ...total },
    });
    return Object.assign(finalized, { occurredAt: event.occurredAt, requestId: event.requestId });
  }

  private key(event: IDomainEvent): string | undefined {
    if (
      !isRecordsBatchCreatedEvent(event) ||
      event.source.type !== 'import' ||
      event.orchestration?.scope !== 'chunk'
    )
      return undefined;
    return `${event.tableId.toString()}:${event.orchestration.operationId ?? event.orchestration.groupId ?? ''}`;
  }
}
