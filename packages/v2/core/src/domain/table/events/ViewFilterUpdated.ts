import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import type { ViewSourceFilterDTO } from '../views/ViewSourceFilter';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewFilterUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewFilterUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly previousFilter: ViewSourceFilterDTO | null | undefined,
    readonly nextFilter: ViewSourceFilterDTO | null | undefined,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    previousFilter: ViewSourceFilterDTO | null | undefined;
    nextFilter: ViewSourceFilterDTO | null | undefined;
    oldVersion?: number;
    newVersion?: number;
  }): ViewFilterUpdated {
    return new ViewFilterUpdated(
      params.tableId,
      params.baseId,
      params.viewId,
      params.previousFilter,
      params.nextFilter,
      params.oldVersion,
      params.newVersion
    );
  }
}
