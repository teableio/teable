import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { ITableActionKey } from '../TableActionKey';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class TableActionTriggerRequested extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.tableActionTriggerRequested();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly actionKey: ITableActionKey,
    readonly payload?: Record<string, unknown>
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    actionKey: ITableActionKey;
    payload?: Record<string, unknown>;
  }): TableActionTriggerRequested {
    return new TableActionTriggerRequested(
      params.tableId,
      params.baseId,
      params.actionKey,
      params.payload
    );
  }
}
