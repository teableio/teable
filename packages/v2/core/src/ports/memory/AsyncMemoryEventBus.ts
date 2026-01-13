import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { isDomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { IEventBus } from '../EventBus';
import type { EventType, IEventHandler } from '../EventHandler';
import { getEventHandlerTokens } from '../EventHandler';
import type { IExecutionContext } from '../ExecutionContext';
import type { IClassToken, IHandlerResolver } from '../HandlerResolver';

export type AsyncEventBusScheduler = (task: () => Promise<void>) => void;

export type AsyncEventBusError = Readonly<{
  error: string;
  event: IDomainEvent;
  handlerName: string;
}>;

export type AsyncMemoryEventBusOptions = Readonly<{
  schedule?: AsyncEventBusScheduler;
  onError?: (error: AsyncEventBusError) => void;
}>;

const resolveErrorMessage = (error: unknown): string => {
  if (isDomainError(error)) return error.message;
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};

const defaultScheduler: AsyncEventBusScheduler = (task) => {
  const scheduler = (globalThis as { queueMicrotask?: (task: () => void) => void }).queueMicrotask;
  if (typeof scheduler === 'function') {
    scheduler(() => void task());
    return;
  }
  const timeout = (
    globalThis as {
      setTimeout?: (handler: () => void, timeout: number) => void;
    }
  ).setTimeout;
  if (typeof timeout === 'function') {
    timeout(() => void task(), 0);
    return;
  }
  void task();
};

export class AsyncMemoryEventBus implements IEventBus {
  private readonly publishedEvents: IDomainEvent[] = [];
  private readonly queue: Array<{ context: IExecutionContext; event: IDomainEvent }> = [];
  private draining = false;

  constructor(
    private readonly handlerResolver: IHandlerResolver,
    private readonly options: AsyncMemoryEventBusOptions = {}
  ) {}

  events(): ReadonlyArray<IDomainEvent> {
    return [...this.publishedEvents];
  }

  async publish(
    context: IExecutionContext,
    event: IDomainEvent
  ): Promise<Result<void, DomainError>> {
    this.enrichWithRequestId(context, event);
    this.publishedEvents.push(event);
    this.enqueue(context, [event]);
    return ok(undefined);
  }

  async publishMany(
    context: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    for (const event of events) {
      this.enrichWithRequestId(context, event);
    }
    this.publishedEvents.push(...events);
    this.enqueue(context, events);
    return ok(undefined);
  }

  private enrichWithRequestId(context: IExecutionContext, event: IDomainEvent): void {
    if (context.requestId && !event.requestId) {
      (event as { requestId?: string }).requestId = context.requestId;
    }
  }

  private enqueue(context: IExecutionContext, events: ReadonlyArray<IDomainEvent>): void {
    for (const event of events) {
      this.queue.push({ context, event });
    }
    if (!this.draining) {
      this.draining = true;
      this.scheduleDrain();
    }
  }

  private scheduleDrain(): void {
    const schedule = this.options.schedule ?? defaultScheduler;
    schedule(async () => {
      await this.drain();
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) continue;
      await this.dispatch(next.context, next.event);
    }
    this.draining = false;
    if (this.queue.length > 0) {
      this.draining = true;
      this.scheduleDrain();
    }
  }

  private async dispatch(context: IExecutionContext, event: IDomainEvent): Promise<void> {
    const eventType = (event as { constructor: EventType<IDomainEvent> }).constructor;
    const handlers = getEventHandlerTokens(eventType as EventType<IDomainEvent>);
    for (const handlerToken of handlers) {
      await this.dispatchToHandler(
        context,
        event,
        handlerToken as IClassToken<IEventHandler<IDomainEvent>>
      );
    }
  }

  private async dispatchToHandler(
    context: IExecutionContext,
    event: IDomainEvent,
    handlerToken: IClassToken<IEventHandler<IDomainEvent>>
  ): Promise<void> {
    let handler: IEventHandler<IDomainEvent>;
    try {
      handler = this.handlerResolver.resolve(handlerToken);
    } catch (error) {
      this.notifyError(error, event, handlerToken);
      return;
    }

    try {
      const result = await handler.handle(context, event);
      if (result.isErr()) {
        this.notifyError(result.error, event, handlerToken);
      }
    } catch (error) {
      this.notifyError(error, event, handlerToken);
    }
  }

  private notifyError(
    error: unknown,
    event: IDomainEvent,
    handlerToken: IClassToken<IEventHandler<IDomainEvent>>
  ): void {
    if (!this.options.onError) return;
    this.options.onError({
      error: resolveErrorMessage(error),
      event,
      handlerName: handlerToken.name,
    });
  }
}
