import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { RecordId } from '../records/RecordId';
import type { ViewId } from '../views/ViewId';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class RecordReordered extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.recordReordered();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly recordIds: ReadonlyArray<RecordId>,
    readonly ordersByRecordId: Readonly<Record<string, number>>,
    readonly previousOrdersByRecordId: Readonly<Record<string, number>>
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    recordIds: ReadonlyArray<RecordId>;
    ordersByRecordId: Readonly<Record<string, number>>;
    previousOrdersByRecordId: Readonly<Record<string, number>>;
  }): RecordReordered {
    return new RecordReordered(
      params.tableId,
      params.baseId,
      params.viewId,
      params.recordIds,
      params.ordersByRecordId,
      params.previousOrdersByRecordId
    );
  }
}
