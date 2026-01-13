import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { RecordId } from '../records/RecordId';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class RecordsDeleted extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.recordsDeleted();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly recordIds: ReadonlyArray<RecordId>
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    recordIds: ReadonlyArray<RecordId>;
  }): RecordsDeleted {
    return new RecordsDeleted(params.tableId, params.baseId, params.recordIds);
  }
}
