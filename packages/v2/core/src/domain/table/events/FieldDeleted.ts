import type { ITablePersistenceDTO } from '../../../ports/mappers/TableMapper';
import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { FieldId } from '../fields/FieldId';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class FieldDeleted extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.fieldDeleted();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly fieldId: FieldId,
    tableSnapshot?: ITablePersistenceDTO
  ) {
    super(tableId, baseId, tableSnapshot);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    fieldId: FieldId;
    tableSnapshot?: ITablePersistenceDTO;
  }): FieldDeleted {
    return new FieldDeleted(params.tableId, params.baseId, params.fieldId, params.tableSnapshot);
  }

  withSnapshot(snapshot: ITablePersistenceDTO): FieldDeleted {
    return new FieldDeleted(this.tableId, this.baseId, this.fieldId, snapshot);
  }
}
