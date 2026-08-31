import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewLockedUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewLockedUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly previousIsLocked: boolean | undefined,
    readonly nextIsLocked: boolean | undefined,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    previousIsLocked: boolean | undefined;
    nextIsLocked: boolean | undefined;
    oldVersion?: number;
    newVersion?: number;
  }): ViewLockedUpdated {
    return new ViewLockedUpdated(
      params.tableId,
      params.baseId,
      params.viewId,
      params.previousIsLocked,
      params.nextIsLocked,
      params.oldVersion,
      params.newVersion
    );
  }
}
