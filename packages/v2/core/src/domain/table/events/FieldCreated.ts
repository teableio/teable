import type { BaseId } from '../../base/BaseId';
import type { IDomainEvent } from '../../shared/DomainEvent';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { FieldId } from '../fields/FieldId';
import type { TableId } from '../TableId';

export class FieldCreated implements IDomainEvent {
  readonly name = DomainEventName.fieldCreated();
  readonly occurredAt = OccurredAt.now();

  private constructor(
    readonly tableId: TableId,
    readonly baseId: BaseId,
    readonly fieldId: FieldId
  ) {}

  static create(params: { tableId: TableId; baseId: BaseId; fieldId: FieldId }): FieldCreated {
    return new FieldCreated(params.tableId, params.baseId, params.fieldId);
  }
}
