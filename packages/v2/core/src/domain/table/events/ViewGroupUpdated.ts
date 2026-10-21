import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewGroupDTO } from '../views/ViewGroup';
import type { ViewId } from '../views/ViewId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewGroupUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewGroupUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly previousGroup: ViewGroupDTO,
    readonly nextGroup: ViewGroupDTO,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    previousGroup: ViewGroupDTO;
    nextGroup: ViewGroupDTO;
    oldVersion?: number;
    newVersion?: number;
  }): ViewGroupUpdated {
    return new ViewGroupUpdated(
      params.tableId,
      params.baseId,
      params.viewId,
      params.previousGroup,
      params.nextGroup,
      params.oldVersion,
      params.newVersion
    );
  }
}
