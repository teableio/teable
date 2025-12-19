import type { DomainEventName } from './DomainEventName';
import type { OccurredAt } from './OccurredAt';

export interface IDomainEvent {
  readonly name: DomainEventName;
  readonly occurredAt: OccurredAt;
}
