import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewDescriptionUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewDescriptionUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly previousDescription: string | undefined,
    readonly nextDescription: string | undefined,
    readonly oldVersion?: number,
    readonly newVersion?: number
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    previousDescription: string | undefined;
    nextDescription: string | undefined;
    oldVersion?: number;
    newVersion?: number;
  }): ViewDescriptionUpdated {
    return new ViewDescriptionUpdated(
      params.tableId,
      params.baseId,
      params.viewId,
      params.previousDescription,
      params.nextDescription,
      params.oldVersion,
      params.newVersion
    );
  }
}
