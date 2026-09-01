import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import type { ViewSortItem } from '../views/ViewSort';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewManualSortApplied extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewManualSortApplied();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly sort: ReadonlyArray<ViewSortItem>
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    sort: ReadonlyArray<ViewSortItem>;
  }): ViewManualSortApplied {
    return new ViewManualSortApplied(
      params.tableId,
      params.baseId,
      params.viewId,
      params.sort.map((item) => ({ ...item }))
    );
  }
}
