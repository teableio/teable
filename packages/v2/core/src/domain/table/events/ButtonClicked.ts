import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { FieldId } from '../fields/FieldId';
import type { RecordId } from '../records/RecordId';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ButtonClicked extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.buttonClicked();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly recordId: RecordId,
    readonly fieldId: FieldId,
    readonly count: number,
    readonly workflowId: string
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    recordId: RecordId;
    fieldId: FieldId;
    count: number;
    workflowId: string;
  }): ButtonClicked {
    return new ButtonClicked(
      params.tableId,
      params.baseId,
      params.recordId,
      params.fieldId,
      params.count,
      params.workflowId
    );
  }
}
