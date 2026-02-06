import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { TableName } from '../TableName';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class TableRenamed extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.tableRenamed();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly previousName: TableName,
    readonly nextName: TableName
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    previousName: TableName;
    nextName: TableName;
  }): TableRenamed {
    return new TableRenamed(params.tableId, params.baseId, params.previousName, params.nextName);
  }
}
