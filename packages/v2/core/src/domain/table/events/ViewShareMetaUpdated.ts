import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import type { ViewShareMetaValue } from '../views/ViewProperties';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewShareMetaUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewShareMetaUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly previousShareMeta: ViewShareMetaValue | undefined,
    readonly nextShareMeta: ViewShareMetaValue | undefined,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    previousShareMeta: ViewShareMetaValue | undefined;
    nextShareMeta: ViewShareMetaValue | undefined;
    oldVersion?: number;
    newVersion?: number;
  }): ViewShareMetaUpdated {
    return new ViewShareMetaUpdated(
      params.tableId,
      params.baseId,
      params.viewId,
      params.previousShareMeta,
      params.nextShareMeta,
      params.oldVersion,
      params.newVersion
    );
  }
}
