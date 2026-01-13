import type { IDomainEvent } from '../../shared/DomainEvent';
import { DomainEventName } from '../../shared/DomainEventName';
import { OccurredAt } from '../../shared/OccurredAt';
import type { BaseId } from '../BaseId';
import type { BaseName } from '../BaseName';

export class BaseCreated implements IDomainEvent {
  readonly name = DomainEventName.baseCreated();
  readonly occurredAt = OccurredAt.now();
  requestId?: string;

  private constructor(
    readonly baseId: BaseId,
    readonly baseName: BaseName
  ) {}

  static create(params: { baseId: BaseId; baseName: BaseName }): BaseCreated {
    return new BaseCreated(params.baseId, params.baseName);
  }
}
