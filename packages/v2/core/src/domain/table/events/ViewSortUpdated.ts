import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import type { ViewSortDTO } from '../views/ViewSort';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewSortUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewSortUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly previousSort: ViewSortDTO,
    readonly nextSort: ViewSortDTO,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    previousSort: ViewSortDTO;
    nextSort: ViewSortDTO;
    oldVersion?: number;
    newVersion?: number;
  }): ViewSortUpdated {
    return new ViewSortUpdated(
      params.tableId,
      params.baseId,
      params.viewId,
      params.previousSort,
      params.nextSort,
      params.oldVersion,
      params.newVersion
    );
  }
}
