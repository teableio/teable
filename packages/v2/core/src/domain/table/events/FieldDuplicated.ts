import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { FieldId } from '../fields/FieldId';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class FieldDuplicated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.fieldDuplicated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly sourceFieldId: FieldId,
    readonly newFieldId: FieldId,
    readonly includeRecordValues: boolean
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    sourceFieldId: FieldId;
    newFieldId: FieldId;
    includeRecordValues: boolean;
  }): FieldDuplicated {
    return new FieldDuplicated(
      params.tableId,
      params.baseId,
      params.sourceFieldId,
      params.newFieldId,
      params.includeRecordValues
    );
  }
}
