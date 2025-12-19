import type { BaseId } from '../../base/BaseId';
import type { IDomainEvent } from '../../shared/DomainEvent';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { FieldId } from '../fields/FieldId';
import type { TableId } from '../TableId';
import type { TableName } from '../TableName';
import type { ViewId } from '../views/ViewId';

export class TableCreated implements IDomainEvent {
  readonly name = DomainEventName.tableCreated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    readonly tableId: TableId,
    readonly baseId: BaseId,
    readonly tableName: TableName,
    readonly fieldIds: ReadonlyArray<FieldId>,
    readonly viewIds: ReadonlyArray<ViewId>
  ) {}

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    tableName: TableName;
    fieldIds: ReadonlyArray<FieldId>;
    viewIds: ReadonlyArray<ViewId>;
  }): TableCreated {
    return new TableCreated(
      params.tableId,
      params.baseId,
      params.tableName,
      [...params.fieldIds],
      [...params.viewIds]
    );
  }
}
