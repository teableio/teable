import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { IEventPublisher } from '../EventPublisher';
import type { IExecutionContext } from '../ExecutionContext';

export class MemoryEventPublisher implements IEventPublisher {
  private readonly publishedEvents: IDomainEvent[] = [];

  events(): ReadonlyArray<IDomainEvent> {
    return [...this.publishedEvents];
  }

  publish(_: IExecutionContext, event: IDomainEvent): Result<void, string> {
    this.publishedEvents.push(event);
    return ok(undefined);
  }

  publishMany(_: IExecutionContext, events: ReadonlyArray<IDomainEvent>): Result<void, string> {
    this.publishedEvents.push(...events);
    return ok(undefined);
  }
}
