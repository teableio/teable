import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { RecordId } from '../records/RecordId';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';
import type { RecordFieldChangeDTO, RecordUpdateSource } from './RecordFieldValuesDTO';

export class RecordUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.recordUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly recordId: RecordId,
    readonly oldVersion: number,
    readonly newVersion: number,
    readonly changes: ReadonlyArray<RecordFieldChangeDTO>,
    readonly source: RecordUpdateSource
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    recordId: RecordId;
    oldVersion: number;
    newVersion: number;
    changes: ReadonlyArray<RecordFieldChangeDTO>;
    source: RecordUpdateSource;
  }): RecordUpdated {
    return new RecordUpdated(
      params.tableId,
      params.baseId,
      params.recordId,
      params.oldVersion,
      params.newVersion,
      params.changes,
      params.source
    );
  }
}
