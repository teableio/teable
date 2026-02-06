import type { DomainEventName } from './DomainEventName';
import type { OccurredAt } from './OccurredAt';

export interface IDomainEvent {
  readonly name: DomainEventName;
  readonly occurredAt: OccurredAt;
  /**
   * Request ID for tracing the entire request flow.
   * Set by the EventBus at publish time from ExecutionContext.
   */
  requestId?: string;
}
