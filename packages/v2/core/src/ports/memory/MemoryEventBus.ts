import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { IEventBus } from '../EventBus';
import type { EventType, IEventHandler } from '../EventHandler';
import { getEventHandlerTokens } from '../EventHandler';
import type { IExecutionContext } from '../ExecutionContext';
import type { IClassToken, IHandlerResolver } from '../HandlerResolver';

export class MemoryEventBus implements IEventBus {
  private readonly publishedEvents: IDomainEvent[] = [];

  constructor(private readonly handlerResolver: IHandlerResolver) {}

  events(): ReadonlyArray<IDomainEvent> {
    return [...this.publishedEvents];
  }

  async publish(
    context: IExecutionContext,
    event: IDomainEvent
  ): Promise<Result<void, DomainError>> {
    this.enrichWithRequestId(context, event);
    this.publishedEvents.push(event);
    return this.dispatch(context, [event]);
  }

  async publishMany(
    context: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    for (const event of events) {
      this.enrichWithRequestId(context, event);
    }
    this.publishedEvents.push(...events);
    return this.dispatch(context, events);
  }

  private enrichWithRequestId(context: IExecutionContext, event: IDomainEvent): void {
    if (context.requestId && !event.requestId) {
      (event as { requestId?: string }).requestId = context.requestId;
    }
  }

  private async dispatch(
    context: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    for (const event of events) {
      const eventType = (event as { constructor: EventType<IDomainEvent> }).constructor;
      const handlers = getEventHandlerTokens(eventType as EventType<IDomainEvent>);
      for (const handlerToken of handlers) {
        try {
          const handler = this.handlerResolver.resolve(
            handlerToken as IClassToken<IEventHandler<IDomainEvent>>
          );
          const result = await handler.handle(context, event);
          if (result.isErr()) {
            return err(result.error);
          }
        } catch (error) {
          if (error instanceof Error) {
            return err(domainError.fromUnknown(error));
          }
          return err(domainError.unexpected({ message: 'Event handler execution failed' }));
        }
      }
    }
    return ok(undefined);
  }
}
