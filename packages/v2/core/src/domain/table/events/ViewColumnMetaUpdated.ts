import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { FieldId } from '../fields/FieldId';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewColumnMetaUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewColumnMetaUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly fieldId: FieldId,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    fieldId: FieldId;
    oldVersion?: number;
    newVersion?: number;
  }): ViewColumnMetaUpdated {
    return new ViewColumnMetaUpdated(
      params.tableId,
      params.baseId,
      params.viewId,
      params.fieldId,
      params.oldVersion,
      params.newVersion
    );
  }
}
