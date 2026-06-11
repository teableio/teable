import type { BaseId } from '../../base/BaseId';
import { createDomainEventGuard } from '../../shared/DomainEvent';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';
import type { RecordUpdateDTO, RecordUpdateSource } from './RecordFieldValuesDTO';

export interface IRecordsBatchUpdatedOrchestration {
  readonly operationId?: string;
  readonly groupId?: string;
  readonly totalRecordCount: number;
  readonly totalChunkCount: number;
  readonly chunkIndex: number;
  readonly scope: 'operation' | 'chunk';
}

export class RecordsBatchUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.recordsBatchUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly updates: ReadonlyArray<RecordUpdateDTO>,
    readonly source: RecordUpdateSource,
    readonly orchestration?: IRecordsBatchUpdatedOrchestration
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    updates: ReadonlyArray<RecordUpdateDTO>;
    source: RecordUpdateSource;
    orchestration?: IRecordsBatchUpdatedOrchestration;
  }): RecordsBatchUpdated {
    return new RecordsBatchUpdated(
      params.tableId,
      params.baseId,
      params.updates,
      params.source,
      params.orchestration
    );
  }
}

const RECORDS_BATCH_UPDATED_EVENT_NAME = DomainEventName.recordsBatchUpdated();

export const isRecordsBatchUpdatedEvent = createDomainEventGuard<RecordsBatchUpdated>(
  RECORDS_BATCH_UPDATED_EVENT_NAME
);
