import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewOptionsUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewOptionsUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly previousOptions: unknown,
    readonly nextOptions: unknown,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    previousOptions: unknown;
    nextOptions: unknown;
    oldVersion?: number;
    newVersion?: number;
  }): ViewOptionsUpdated {
    return new ViewOptionsUpdated(
      params.tableId,
      params.baseId,
      params.viewId,
      params.previousOptions,
      params.nextOptions,
      params.oldVersion,
      params.newVersion
    );
  }
}
