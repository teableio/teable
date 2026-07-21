import type { BaseId } from '../../base/BaseId';
import { createDomainEventGuard, type IDomainEvent } from '../../shared/DomainEvent';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { FieldComputeMetaDto } from '../FieldComputeMeta';
import type { TableComputeMetaDto } from '../TableComputeMeta';

export class ComputedActivityBatchChanged implements IDomainEvent {
  readonly name = DomainEventName.computedActivityBatchChanged();
  readonly occurredAt = OccurredAt.now();
  requestId?: string;

  private constructor(
    readonly baseId: BaseId,
    readonly fields: ReadonlyArray<FieldComputeMetaDto>,
    readonly tables: ReadonlyArray<TableComputeMetaDto>
  ) {}

  static create(params: {
    baseId: BaseId;
    fields: ReadonlyArray<FieldComputeMetaDto>;
    tables: ReadonlyArray<TableComputeMetaDto>;
  }): ComputedActivityBatchChanged {
    return new ComputedActivityBatchChanged(params.baseId, params.fields, params.tables);
  }
}

const EVENT_NAME = DomainEventName.computedActivityBatchChanged();

export const isComputedActivityBatchChangedEvent =
  createDomainEventGuard<ComputedActivityBatchChanged>(EVENT_NAME);
