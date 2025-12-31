import type { ITablePersistenceDTO } from '../../../ports/mappers/TableMapper';
import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { FieldId } from '../fields/FieldId';
import type { TableId } from '../TableId';
import type { ViewId } from '../views/ViewId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class ViewColumnMetaUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.viewColumnMetaUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly viewId: ViewId,
    readonly fieldId: FieldId,
    tableSnapshot?: ITablePersistenceDTO
  ) {
    super(tableId, baseId, tableSnapshot);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    viewId: ViewId;
    fieldId: FieldId;
    tableSnapshot?: ITablePersistenceDTO;
  }): ViewColumnMetaUpdated {
    return new ViewColumnMetaUpdated(
      params.tableId,
      params.baseId,
      params.viewId,
      params.fieldId,
      params.tableSnapshot
    );
  }

  withSnapshot(snapshot: ITablePersistenceDTO): ViewColumnMetaUpdated {
    return new ViewColumnMetaUpdated(
      this.tableId,
      this.baseId,
      this.viewId,
      this.fieldId,
      snapshot
    );
  }
}
