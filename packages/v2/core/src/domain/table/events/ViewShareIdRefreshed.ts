import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewShareIdRefreshed extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewShareIdRefreshed();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly previousShareId: string | undefined,
    readonly nextShareId: string,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    previousShareId: string | undefined;
    nextShareId: string;
    oldVersion?: number;
    newVersion?: number;
  }): ViewShareIdRefreshed {
    return new ViewShareIdRefreshed(
      params.tableId,
      params.baseId,
      params.viewId,
      params.previousShareId,
      params.nextShareId,
      params.oldVersion,
      params.newVersion
    );
  }
}
