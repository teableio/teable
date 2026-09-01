import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';
import type { TableProperties } from '../TableProperties';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export class TablePropertiesUpdated extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.tablePropertiesUpdated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly previousProperties: TableProperties,
    readonly nextProperties: TableProperties
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    previousProperties: TableProperties;
    nextProperties: TableProperties;
  }): TablePropertiesUpdated {
    return new TablePropertiesUpdated(
      params.tableId,
      params.baseId,
      params.previousProperties,
      params.nextProperties
    );
  }
}
