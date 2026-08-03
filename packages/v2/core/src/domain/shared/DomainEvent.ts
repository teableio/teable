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

export type DomainEventGuard<TEvent extends IDomainEvent> = (
  event: IDomainEvent
) => event is TEvent;

export const hasDomainEventName = (event: IDomainEvent, eventName: DomainEventName): boolean =>
  event.name.equals(eventName);

export const createDomainEventGuard =
  <TEvent extends IDomainEvent>(eventName: DomainEventName): DomainEventGuard<TEvent> =>
  (event: IDomainEvent): event is TEvent =>
    hasDomainEventName(event, eventName);
