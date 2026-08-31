import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import type { ViewName } from '../views/ViewName';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewRenamed extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewRenamed();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly previousName: ViewName,
    readonly nextName: ViewName,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    previousName: ViewName;
    nextName: ViewName;
    oldVersion?: number;
    newVersion?: number;
  }): ViewRenamed {
    return new ViewRenamed(
      params.tableId,
      params.baseId,
      params.viewId,
      params.previousName,
      params.nextName,
      params.oldVersion,
      params.newVersion
    );
  }
}
