import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewCreated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewCreated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    oldVersion?: number;
    newVersion?: number;
  }): ViewCreated {
    return new ViewCreated(
      params.tableId,
      params.baseId,
      params.viewId,
      params.oldVersion,
      params.newVersion
    );
  }
}
