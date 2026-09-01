import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import type { ViewOrder } from '../views/ViewOrder';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewOrderUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewOrderUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly previousOrder: ViewOrder,
    readonly nextOrder: ViewOrder,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    previousOrder: ViewOrder;
    nextOrder: ViewOrder;
    oldVersion?: number;
    newVersion?: number;
  }): ViewOrderUpdated {
    return new ViewOrderUpdated(
      params.tableId,
      params.baseId,
      params.viewId,
      params.previousOrder,
      params.nextOrder,
      params.oldVersion,
      params.newVersion
    );
  }
}
