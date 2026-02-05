import type { IDomainEvent } from './DomainEvent';
import { Entity } from './Entity';

export abstract class AggregateRoot<Id> extends Entity<Id> {
  private readonly domainEvents: IDomainEvent[] = [];

  addDomainEvent(event: IDomainEvent): void {
    this.domainEvents.push(event);
  }

  /**
   * Records multiple domain events. Used by external event generators (like spec visitors).
   */
  recordDomainEvents(events: ReadonlyArray<IDomainEvent>): void {
    for (const event of events) {
      this.domainEvents.push(event);
    }
  }

  pullDomainEvents(): IDomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents.length = 0;
    return events;
  }
}
