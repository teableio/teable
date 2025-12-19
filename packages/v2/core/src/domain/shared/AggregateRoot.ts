import type { IDomainEvent } from './DomainEvent';
import { Entity } from './Entity';

export abstract class AggregateRoot<Id> extends Entity<Id> {
  private readonly domainEvents: IDomainEvent[] = [];

  protected addDomainEvent(event: IDomainEvent): void {
    this.domainEvents.push(event);
  }

  pullDomainEvents(): IDomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents.length = 0;
    return events;
  }
}
