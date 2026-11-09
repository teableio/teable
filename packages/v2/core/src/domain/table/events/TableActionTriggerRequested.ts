import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

/**
 * Table action-trigger keys carried on the table update presence channel.
 *
 * Mirrors the table half of the legacy `tableActionKeys` enum in @teable/core.
 * It is owned here so `@teable/v2-core` keeps no type dependency on the v1
 * package; hosts consuming the event still type it against the v1 key union,
 * so this must stay a subset of that vocabulary.
 */
export type TableActionKey =
  | 'addRecord'
  | 'setRecord'
  | 'deleteRecord'
  | 'addField'
  | 'setField'
  | 'deleteField'
  | 'taskProcessing'
  | 'taskCompleted'
  | 'taskCancelled'
  | 'taskFailed'
  | 'computeActivityChanged';

export class TableActionTriggerRequested extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.tableActionTriggerRequested();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly actionKey: TableActionKey,
    readonly payload?: Record<string, unknown>
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    actionKey: TableActionKey;
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
