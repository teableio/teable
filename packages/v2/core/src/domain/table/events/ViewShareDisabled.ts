import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import type { ViewShareMetaValue } from '../views/ViewProperties';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewShareDisabled extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewShareDisabled();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly previousShareId: string | undefined,
    readonly shareMeta: ViewShareMetaValue | undefined,
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
    shareMeta: ViewShareMetaValue | undefined;
    oldVersion?: number;
    newVersion?: number;
  }): ViewShareDisabled {
    return new ViewShareDisabled(
      params.tableId,
      params.baseId,
      params.viewId,
      params.previousShareId,
      params.shareMeta,
      params.oldVersion,
      params.newVersion
    );
  }
}
