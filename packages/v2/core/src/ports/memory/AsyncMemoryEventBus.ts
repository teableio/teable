import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { isDomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { isRecordsBatchCreatedEvent } from '../../domain/table/events/RecordsBatchCreated';
import { isRecordsBatchUpdatedEvent } from '../../domain/table/events/RecordsBatchUpdated';
import type { IEventBus } from '../EventBus';
import type { EventType, IEventHandler } from '../EventHandler';
import { getEventHandlerRole, getEventHandlerTokens } from '../EventHandler';
import type { IExecutionContext } from '../ExecutionContext';
import type { IClassToken, IHandlerResolver } from '../HandlerResolver';
import { TeableSpanAttributes } from '../Tracer';

export type AsyncEventBusScheduler = (task: () => Promise<void>) => void;

export type AsyncEventBusError = Readonly<{
  error: string;
  event: IDomainEvent;
  handlerName: string;
}>;

export type AsyncMemoryEventBusOptions = Readonly<{
  schedule?: AsyncEventBusScheduler;
  onError?: (error: AsyncEventBusError) => void;
  largeBatchProjectionSerialThreshold?: number;
  recordPublishedEvents?: boolean;
}>;

const DEFAULT_LARGE_BATCH_PROJECTION_SERIAL_THRESHOLD = 1000;

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
  private readonly recordPublishedEvents: boolean;

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
  ) {
    this.recordPublishedEvents = options.recordPublishedEvents ?? true;
  }

  private shouldDispatchProjectionGroupConcurrently(event: IDomainEvent): boolean {
    const threshold =
      this.options.largeBatchProjectionSerialThreshold ??
      DEFAULT_LARGE_BATCH_PROJECTION_SERIAL_THRESHOLD;

    if (isRecordsBatchUpdatedEvent(event)) {
      return event.updates.length <= threshold;
    }

    if (isRecordsBatchCreatedEvent(event)) {
      return event.records.length <= threshold;
    }

    return true;
  }

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
    this.maybeRecordPublishedEvents([event]);
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
    this.maybeRecordPublishedEvents(events);
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

  private maybeRecordPublishedEvents(events: ReadonlyArray<IDomainEvent>): void {
    if (!this.recordPublishedEvents || !events.length) {
      return;
    }

    this.publishedEvents.push(...events);
  }

  private enqueue(context: IExecutionContext, events: ReadonlyArray<IDomainEvent>): number {
    const contextSnapshot = snapshotExecutionContext(context);
    let targetSeq = this.processedSeq;
    for (const event of events) {
      const seq = this.nextSeq;
      this.nextSeq += 1;
      targetSeq = seq;
      this.queue.push({ context: contextSnapshot, event, seq });
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
    let projectionGroup: Array<IClassToken<IEventHandler<IDomainEvent>>> = [];
    const shouldDispatchProjectionGroupConcurrently =
      this.shouldDispatchProjectionGroupConcurrently(event);

    // Consecutive @ProjectionHandler handlers are dispatched concurrently.
    // A non-projection handler creates an ordering boundary: the preceding
    // projection group must finish before that handler runs, and any following
    // projection handlers begin a fresh concurrent group afterward.
    // Handler registration order therefore affects concurrency grouping.
    // Large batch record events are the exception: they fall back to serial
    // projection dispatch to avoid multiplying memory retained by heavy
    // handlers like record history, automation matching, realtime payload
    // generation, and task fan-out on the same giant event payload.
    const flushProjectionGroup = async () => {
      if (!projectionGroup.length) {
        return;
      }

      const currentGroup = projectionGroup;
      projectionGroup = [];
      await this.traceProjectionGroup(
        context,
        event,
        currentGroup,
        shouldDispatchProjectionGroupConcurrently || currentGroup.length === 1
          ? 'concurrent'
          : 'serial',
        async () => {
          if (shouldDispatchProjectionGroupConcurrently || currentGroup.length === 1) {
            await Promise.all(
              currentGroup.map((handlerToken) =>
                this.dispatchToHandler(context, event, handlerToken)
              )
            );
            return;
          }

          for (const handlerToken of currentGroup) {
            await this.dispatchToHandler(context, event, handlerToken);
          }
        }
      );
    };

    for (const handlerToken of handlers as Array<IClassToken<IEventHandler<IDomainEvent>>>) {
      if (getEventHandlerRole(handlerToken) === 'projection') {
        projectionGroup.push(handlerToken);
        continue;
      }

      await flushProjectionGroup();
      await this.dispatchToHandler(context, event, handlerToken);
    }

    await flushProjectionGroup();
  }

  private async traceProjectionGroup(
    context: IExecutionContext,
    event: IDomainEvent,
    handlers: ReadonlyArray<IClassToken<IEventHandler<IDomainEvent>>>,
    mode: 'concurrent' | 'serial',
    callback: () => Promise<void>
  ): Promise<void> {
    const tracer = context.tracer;
    if (!tracer) {
      await callback();
      return;
    }

    let span;
    try {
      span = tracer.startSpan('teable.AsyncMemoryEventBus.projectionGroup', {
        [TeableSpanAttributes.VERSION]: 'v2',
        [TeableSpanAttributes.COMPONENT]: 'projection',
        [TeableSpanAttributes.HANDLER]: 'AsyncMemoryEventBus',
        [TeableSpanAttributes.OPERATION]: 'AsyncMemoryEventBus.projectionGroup',
        [TeableSpanAttributes.EVENT_NAME]: event.name.toString(),
        [TeableSpanAttributes.EVENT_ROLE]: 'projection',
        [TeableSpanAttributes.EVENT_GROUP_MODE]: mode,
        [TeableSpanAttributes.EVENT_HANDLER_COUNT]: handlers.length,
        [TeableSpanAttributes.EVENT_ASYNC]: true,
        'teable.message': event.constructor.name,
      });
    } catch {
      await callback();
      return;
    }

    await tracer.withSpan(span, async () => {
      try {
        await callback();
      } finally {
        span.end();
      }
    });
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

const snapshotExecutionContext = (context: IExecutionContext): IExecutionContext => ({
  ...context,
  undoRedo: context.undoRedo ? { ...context.undoRedo } : undefined,
  duplicateTable: context.duplicateTable ? { ...context.duplicateTable } : undefined,
  config: context.config
    ? {
        ...context.config,
        selectFieldOptions: context.config.selectFieldOptions
          ? { ...context.config.selectFieldOptions }
          : undefined,
        tableFields: context.config.tableFields ? { ...context.config.tableFields } : undefined,
      }
    : undefined,
});
