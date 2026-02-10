import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';
import type { RecordCreateSource, RecordValuesDTO } from './RecordFieldValuesDTO';

export class RecordsBatchCreated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.recordsBatchCreated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly records: ReadonlyArray<RecordValuesDTO>,
    readonly source: RecordCreateSource
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    records: ReadonlyArray<RecordValuesDTO>;
    source?: RecordCreateSource;
  }): RecordsBatchCreated {
    return new RecordsBatchCreated(
      params.tableId,
      params.baseId,
      params.records,
      params.source ?? { type: 'user' }
    );
  }
}
