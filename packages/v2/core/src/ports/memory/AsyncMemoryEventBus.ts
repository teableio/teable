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
  const immediate = (globalThis as { setImmediate?: (task: () => void) => void }).setImmediate;
  if (typeof immediate === 'function') {
    immediate(() => void task());
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

  const scheduler = (globalThis as { queueMicrotask?: (task: () => void) => void }).queueMicrotask;
  if (typeof scheduler === 'function') {
    scheduler(() => void task());
    return;
  }

  void task();
};

export class AsyncMemoryEventBus implements IEventBus {
  private readonly publishedEvents: IDomainEvent[] = [];
  private readonly queue: Array<{ context: IExecutionContext; event: IDomainEvent; seq: number }> =
    [];
  private readonly waiters: Array<{ targetSeq: number; resolve: () => void }> = [];
  private draining = false;
  private nextSeq = 0;
  private processedSeq = -1;

  private shouldAwait(events: ReadonlyArray<IDomainEvent>): boolean {
    if (!events.length) return false;

    const awaitableEventNames = new Set([
      'FieldCreated',
      'FieldUpdated',
      'FieldDeleted',
      'FieldDuplicated',
      'FieldOptionsAdded',
      'ViewColumnMetaUpdated',
    ]);

    return events.every((event) => awaitableEventNames.has(event.name.toString()));
  }

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
    const shouldAwait = this.shouldAwait([event]);
    const wasDraining = this.draining;
    this.enrichWithRequestId(context, event);
    this.publishedEvents.push(event);
    const targetSeq = this.enqueue(context, [event]);
    if (shouldAwait && !wasDraining) {
      await this.waitUntilProcessed(targetSeq);
    }
    return ok(undefined);
  }

  async publishMany(
    context: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    if (!events.length) {
      return ok(undefined);
    }
    const shouldAwait = this.shouldAwait(events);
    const wasDraining = this.draining;
    for (const event of events) {
      this.enrichWithRequestId(context, event);
    }
    this.publishedEvents.push(...events);
    const targetSeq = this.enqueue(context, events);
    if (shouldAwait && !wasDraining) {
      await this.waitUntilProcessed(targetSeq);
    }
    return ok(undefined);
  }

  private enrichWithRequestId(context: IExecutionContext, event: IDomainEvent): void {
    if (context.requestId && !event.requestId) {
      (event as { requestId?: string }).requestId = context.requestId;
    }
  }

  private enqueue(context: IExecutionContext, events: ReadonlyArray<IDomainEvent>): number {
    let targetSeq = this.processedSeq;
    for (const event of events) {
      const seq = this.nextSeq;
      this.nextSeq += 1;
      targetSeq = seq;
      this.queue.push({ context, event, seq });
    }
    if (!this.draining) {
      this.draining = true;
      this.scheduleDrain();
    }
    return targetSeq;
  }

  private waitUntilProcessed(targetSeq: number): Promise<void> {
    if (targetSeq <= this.processedSeq) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.waiters.push({ targetSeq, resolve });
    });
  }

  private resolveWaiters(): void {
    if (!this.waiters.length) return;

    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];
      if (waiter.targetSeq <= this.processedSeq) {
        this.waiters.splice(i, 1);
        waiter.resolve();
      }
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
      this.processedSeq = next.seq;
      this.resolveWaiters();
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
