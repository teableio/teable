import type { BaseId } from '../../base/BaseId';
import { createDomainEventGuard } from '../../shared/DomainEvent';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';
import type { RecordCreateSource, RecordValuesDTO } from './RecordFieldValuesDTO';

export interface IRecordsBatchCreatedOrchestration {
  readonly operationId?: string;
  readonly groupId?: string;
  readonly totalRecordCount: number;
  readonly totalChunkCount: number;
  readonly chunkIndex: number;
  readonly scope: 'operation' | 'chunk';
}

export class RecordsBatchCreated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.recordsBatchCreated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly records: ReadonlyArray<RecordValuesDTO>,
    readonly source: RecordCreateSource,
    readonly orchestration?: IRecordsBatchCreatedOrchestration
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    records: ReadonlyArray<RecordValuesDTO>;
    source?: RecordCreateSource;
    orchestration?: IRecordsBatchCreatedOrchestration;
  }): RecordsBatchCreated {
    return new RecordsBatchCreated(
      params.tableId,
      params.baseId,
      params.records,
      params.source ?? { type: 'user' },
      params.orchestration
    );
  }
}

const RECORDS_BATCH_CREATED_EVENT_NAME = DomainEventName.recordsBatchCreated();

export const isRecordsBatchCreatedEvent = createDomainEventGuard<RecordsBatchCreated>(
  RECORDS_BATCH_CREATED_EVENT_NAME
);
