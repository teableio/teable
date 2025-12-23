import type { BaseId } from '../../base/BaseId';
import type { IDomainEvent } from '../../shared/DomainEvent';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { TableName } from '../TableName';

export class TableRenamed implements IDomainEvent {
  readonly name = DomainEventName.tableRenamed();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    readonly tableId: TableId,
    readonly baseId: BaseId,
    readonly previousName: TableName,
    readonly nextName: TableName
  ) {}

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    previousName: TableName;
    nextName: TableName;
  }): TableRenamed {
    return new TableRenamed(params.tableId, params.baseId, params.previousName, params.nextName);
  }
}
