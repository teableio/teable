import type { BaseId } from '../../base/BaseId';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { FieldId } from '../fields/FieldId';
import type { SelectOption } from '../fields/types/SelectOption';
import type { TableId } from '../TableId';
import { AbstractTableUpdatedEvent } from './AbstractTableUpdatedEvent';

export interface SelectOptionDTO {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export class FieldOptionsAdded extends AbstractTableUpdatedEvent {
  readonly name = DomainEventName.fieldOptionsAdded();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    tableId: TableId,
    baseId: BaseId,
    readonly fieldId: FieldId,
    readonly options: ReadonlyArray<SelectOptionDTO>
  ) {
    super(tableId, baseId);
  }

  static create(params: {
    tableId: TableId;
    baseId: BaseId;
    fieldId: FieldId;
    options: ReadonlyArray<SelectOption>;
  }): FieldOptionsAdded {
    const optionDtos = params.options.map((opt) => opt.toDto());
    return new FieldOptionsAdded(params.tableId, params.baseId, params.fieldId, optionDtos);
  }
}
