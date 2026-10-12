import type { BaseId } from '../../base/BaseId';
import type { IDomainEvent } from '../../shared/DomainEvent';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';

/**
 * A table left the pending provision state after a physical schema change.
 * Table list queries exclude pending tables, so a subscriber that polled during
 * the pending window dropped the table; re-ensuring the Table document is the
 * only realtime signal that puts it back.
 */
export class TableProvisionReady implements IDomainEvent {
  readonly name = DomainEventName.tableProvisionReady();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    readonly tableId: TableId,
    readonly baseId: BaseId
  ) {}

  static create(params: { tableId: TableId; baseId: BaseId }): TableProvisionReady {
    return new TableProvisionReady(params.tableId, params.baseId);
  }
}
