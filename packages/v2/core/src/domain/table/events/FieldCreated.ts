import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { FieldId } from '../fields/FieldId';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class FieldCreated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.fieldCreated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly fieldId: FieldId
  ) {
    super(tableId, baseId);
  }

  static create(params: { tableId: TableId; baseId: BaseId; fieldId: FieldId }): FieldCreated {
    return new FieldCreated(params.tableId, params.baseId, params.fieldId);
  }
}
