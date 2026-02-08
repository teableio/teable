import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { RecordId } from '../records/RecordId';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';
import type { RecordFieldValueDTO } from './RecordFieldValuesDTO';

export class RecordCreated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.recordCreated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly recordId: RecordId,
    readonly fieldValues: ReadonlyArray<RecordFieldValueDTO>
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    recordId: RecordId;
    fieldValues: ReadonlyArray<RecordFieldValueDTO>;
  }): RecordCreated {
    return new RecordCreated(params.tableId, params.baseId, params.recordId, params.fieldValues);
  }
}
