import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import type { ViewShareMetaValue } from '../views/ViewProperties';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewShareEnabled extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewShareEnabled();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly shareId: string,
    readonly shareMeta: ViewShareMetaValue,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    shareId: string;
    shareMeta: ViewShareMetaValue;
    oldVersion?: number;
    newVersion?: number;
  }): ViewShareEnabled {
    return new ViewShareEnabled(
      params.tableId,
      params.baseId,
      params.viewId,
      params.shareId,
      params.shareMeta,
      params.oldVersion,
      params.newVersion
    );
  }
}
