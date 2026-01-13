import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';
import type { RecordUpdateDTO, RecordUpdateSource } from './RecordFieldValuesDTO';

export class RecordsBatchUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.recordsBatchUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly updates: ReadonlyArray<RecordUpdateDTO>,
    readonly source: RecordUpdateSource
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    updates: ReadonlyArray<RecordUpdateDTO>;
    source: RecordUpdateSource;
  }): RecordsBatchUpdated {
    return new RecordsBatchUpdated(params.tableId, params.baseId, params.updates, params.source);
  }
}
