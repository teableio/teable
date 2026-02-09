import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { RecordId } from '../records/RecordId';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

/**
 * Snapshot of a deleted record for undo/redo support.
 * Contains all necessary data to recreate the record.
 */
export interface IDeletedRecordSnapshot {
  readonly id: string;
  readonly fields: Record<string, unknown>;
  readonly autoNumber?: number;
  readonly createdTime?: string;
  readonly createdBy?: string;
  readonly lastModifiedTime?: string;
  readonly lastModifiedBy?: string;
  /** View order values: viewId -> order number. Used for undo/redo. */
  readonly orders?: Record<string, number>;
}

export class RecordsDeleted extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.recordsDeleted();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly recordIds: ReadonlyArray<RecordId>,
    readonly recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    recordIds: ReadonlyArray<RecordId>;
    recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>;
  }): RecordsDeleted {
    return new RecordsDeleted(
      params.tableId,
      params.baseId,
      params.recordIds,
      params.recordSnapshots
    );
  }
}
