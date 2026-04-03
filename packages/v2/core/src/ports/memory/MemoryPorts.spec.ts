import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ProjectionHandler } from '../../application/projections/Projection';
import { CommandHandler, type ICommandHandler } from '../../commands/CommandHandler';
import { PublicCommand } from '../../commands/PublicCommand';
import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { DomainEventName } from '../../domain/shared/DomainEventName';
import { OccurredAt } from '../../domain/shared/OccurredAt';
import { OffsetPagination } from '../../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../../domain/shared/pagination/PageLimit';
import { PageOffset } from '../../domain/shared/pagination/PageOffset';
import { Sort } from '../../domain/shared/sort/Sort';
import { SortDirection } from '../../domain/shared/sort/SortDirection';
import { FieldName } from '../../domain/table/fields/FieldName';
import { Table } from '../../domain/table/Table';
import { TableName } from '../../domain/table/TableName';
import { TableSortKey } from '../../domain/table/TableSortKey';
import { QueryHandler, type IQueryHandler } from '../../queries/QueryHandler';
import type { ICommandBusMiddleware } from '../CommandBus';
import { EventHandler, type IEventHandler } from '../EventHandler';
import type { IExecutionContext } from '../ExecutionContext';
import type { IHandlerResolver, IClassToken } from '../HandlerResolver';
import type { IQueryBusMiddleware } from '../QueryBus';
import type { ISpan, ITracer, SpanAttributes } from '../Tracer';
import { TeableSpanAttributes } from '../Tracer';
import type { AsyncEventBusError, AsyncEventBusScheduler } from './AsyncMemoryEventBus';
import { AsyncMemoryEventBus } from './AsyncMemoryEventBus';
import { MemoryCommandBus } from './MemoryCommandBus';
import { MemoryEventBus } from './MemoryEventBus';
import { MemoryQueryBus } from './MemoryQueryBus';
import { MemoryTableRepository } from './MemoryTableRepository';

const waitForPredicate = async (predicate: () => boolean, timeoutMs = 100): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for predicate');
    }
    await Promise.resolve();
  }
};

class FakeSpan implements ISpan {
  readonly attributes: Array<[string, string | number | boolean]> = [];
  readonly errors: string[] = [];
  ended = false;

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes.push([key, value]);
  }

  setAttributes(attrs: SpanAttributes): void {
    for (const [key, value] of Object.entries(attrs)) {
      this.attributes.push([key, value]);
    }
  }

  recordError(message: string): void {
    this.errors.push(message);
  }

  end(): void {
    this.ended = true;
  }
}

class FakeTracer implements ITracer {
  readonly spans: Array<{
    name: string;
    attributes?: SpanAttributes;
    span: FakeSpan;
    parentName?: string;
  }> = [];
  private readonly activeStack: FakeSpan[] = [];
  private readonly activeNames = new Map<FakeSpan, string>();

  startSpan(name: string, attributes?: SpanAttributes): ISpan {
    const span = new FakeSpan();
    const parent = this.activeStack.at(-1);
    this.spans.push({
      name,
      attributes,
      span,
      parentName: parent ? this.activeNames.get(parent) : undefined,
    });
    this.activeNames.set(span, name);
    return span;
  }

  async withSpan<T>(span: ISpan, callback: () => Promise<T>): Promise<T> {
    const fakeSpan = span as FakeSpan;
    this.activeStack.push(fakeSpan);
    try {
      return await callback();
    } finally {
      this.activeStack.pop();
    }
  }

  getActiveSpan(): ISpan | undefined {
    return this.activeStack.at(-1);
  }
}

class MapResolver implements IHandlerResolver {
  private readonly instances = new Map<IClassToken<unknown>, unknown>();

  resolve<T>(token: IClassToken<T>): T {
    const existing = this.instances.get(token);
    if (existing) return existing as T;
    const instance = new token();
    this.instances.set(token, instance);
    return instance;
  }
}

const createContext = (tracer?: ITracer): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId, tracer };
};

describe('MemoryCommandBus', () => {
  it('executes command handlers', async () => {
    class PingCommand extends PublicCommand {}

    @CommandHandler(PingCommand)
    class PingHandler implements ICommandHandler<PingCommand, string> {
      async handle(
        _context: IExecutionContext,
        _command: PingCommand
      ): ReturnType<ICommandHandler<PingCommand, string>['handle']> {
        return ok('pong');
      }
    }
    expect(PingHandler).toBeDefined();

    const resolver = new MapResolver();
    const bus = new MemoryCommandBus(resolver);
    const result = await bus.execute(createContext(), new PingCommand());
    const payload = result._unsafeUnwrap();
    expect(payload).toBe('pong');
  });

  it('returns error when handler is missing', async () => {
    class MissingCommand extends PublicCommand {}
    const bus = new MemoryCommandBus(new MapResolver());
    const result = await bus.execute(createContext(), new MissingCommand());
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toContain('Missing command handler');
  });

  it('handles handler exceptions and middleware errors', async () => {
    class CrashCommand extends PublicCommand {}

    @CommandHandler(CrashCommand)
    class CrashHandler implements ICommandHandler<CrashCommand, string> {
      async handle(
        _context: IExecutionContext,
        _command: CrashCommand
      ): ReturnType<ICommandHandler<CrashCommand, string>['handle']> {
        throw new Error('boom');
      }
    }
    expect(CrashHandler).toBeDefined();

    const middleware: ICommandBusMiddleware = {
      async handle() {
        throw new Error('middleware');
      },
    };

    const resolver = new MapResolver();
    const bus = new MemoryCommandBus(resolver);
    const handlerResult = await bus.execute(createContext(), new CrashCommand());
    expect(handlerResult._unsafeUnwrapErr().message).toContain('boom');

    const busWithMiddleware = new MemoryCommandBus(resolver, [middleware]);
    const middlewareResult = await busWithMiddleware.execute(createContext(), new CrashCommand());
    expect(middlewareResult._unsafeUnwrapErr().message).toContain('middleware');
  });
});

describe('MemoryQueryBus', () => {
  it('executes query handlers', async () => {
    class PingQuery {}

    @QueryHandler(PingQuery)
    class PingQueryHandler implements IQueryHandler<PingQuery, string> {
      async handle(
        _context: IExecutionContext,
        _query: PingQuery
      ): ReturnType<IQueryHandler<PingQuery, string>['handle']> {
        return ok('pong');
      }
    }
    expect(PingQueryHandler).toBeDefined();

    const resolver = new MapResolver();
    const bus = new MemoryQueryBus(resolver);
    const result = await bus.execute(createContext(), new PingQuery());
    const payload = result._unsafeUnwrap();
    expect(payload).toBe('pong');
  });

  it('returns error when handler is missing', async () => {
    class MissingQuery {}
    const bus = new MemoryQueryBus(new MapResolver());
    const result = await bus.execute(createContext(), new MissingQuery());
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toContain('Missing query handler');
  });

  it('handles handler exceptions and middleware errors', async () => {
    class CrashQuery {}

    @QueryHandler(CrashQuery)
    class CrashQueryHandler implements IQueryHandler<CrashQuery, string> {
      async handle(
        _context: IExecutionContext,
        _query: CrashQuery
      ): ReturnType<IQueryHandler<CrashQuery, string>['handle']> {
        throw new Error('boom');
      }
    }
    expect(CrashQueryHandler).toBeDefined();

    const middleware: IQueryBusMiddleware = {
      async handle() {
        throw new Error('middleware');
      },
    };

    const resolver = new MapResolver();
    const bus = new MemoryQueryBus(resolver);
    const handlerResult = await bus.execute(createContext(), new CrashQuery());
    expect(handlerResult._unsafeUnwrapErr().message).toContain('boom');

    const busWithMiddleware = new MemoryQueryBus(resolver, [middleware]);
    const middlewareResult = await busWithMiddleware.execute(createContext(), new CrashQuery());
    expect(middlewareResult._unsafeUnwrapErr().message).toContain('middleware');
  });
});

describe('MemoryEventBus', () => {
  it('publishes events and dispatches handlers', async () => {
    class PingEvent implements IDomainEvent {
      readonly name = DomainEventName.tableCreated();
      readonly occurredAt = OccurredAt.now();
    }

    let handled = 0;

    @EventHandler(PingEvent)
    class PingEventHandler implements IEventHandler<PingEvent> {
      async handle(
        _context: IExecutionContext,
        _event: PingEvent
      ): ReturnType<IEventHandler<PingEvent>['handle']> {
        handled += 1;
        return ok(undefined);
      }
    }
    expect(PingEventHandler).toBeDefined();

    const resolver = new MapResolver();
    const bus = new MemoryEventBus(resolver);
    const context = createContext();
    const event = new PingEvent();
    const publishResult = await bus.publish(context, event);
    publishResult._unsafeUnwrap();
    expect(bus.events().length).toBe(1);
    expect(handled).toBe(1);

    const publishManyResult = await bus.publishMany(context, [event]);
    publishManyResult._unsafeUnwrap();
    expect(bus.events().length).toBe(2);
  });

  it('returns error when handler fails or throws', async () => {
    class FailingEvent implements IDomainEvent {
      readonly name = DomainEventName.tableCreated();
      readonly occurredAt = OccurredAt.now();
    }

    @EventHandler(FailingEvent)
    class FailingEventHandler implements IEventHandler<FailingEvent> {
      async handle(
        _context: IExecutionContext,
        _event: FailingEvent
      ): ReturnType<IEventHandler<FailingEvent>['handle']> {
        return err(domainError.unexpected({ message: 'fail' }));
      }
    }
    expect(FailingEventHandler).toBeDefined();

    class ThrowingEvent implements IDomainEvent {
      readonly name = DomainEventName.tableCreated();
      readonly occurredAt = OccurredAt.now();
    }

    @EventHandler(ThrowingEvent)
    class ThrowingEventHandler implements IEventHandler<ThrowingEvent> {
      async handle(
        _context: IExecutionContext,
        _event: ThrowingEvent
      ): ReturnType<IEventHandler<ThrowingEvent>['handle']> {
        throw new Error('boom');
      }
    }
    expect(ThrowingEventHandler).toBeDefined();

    const resolver = new MapResolver();
    const bus = new MemoryEventBus(resolver);
    const context = createContext();

    const failResult = await bus.publish(context, new FailingEvent());
    expect(failResult._unsafeUnwrapErr().message).toBe('fail');

    const throwResult = await bus.publish(context, new ThrowingEvent());
    expect(throwResult._unsafeUnwrapErr().message).toContain('boom');
  });
});

describe('AsyncMemoryEventBus', () => {
  it('publishes events without waiting for handlers', async () => {
    class PingEvent implements IDomainEvent {
      readonly name = DomainEventName.tableCreated();
      readonly occurredAt = OccurredAt.now();
    }

    let handled = 0;

    @EventHandler(PingEvent)
    class PingEventHandler implements IEventHandler<PingEvent> {
      async handle(
        _context: IExecutionContext,
        _event: PingEvent
      ): ReturnType<IEventHandler<PingEvent>['handle']> {
        handled += 1;
        return ok(undefined);
      }
    }
    expect(PingEventHandler).toBeDefined();

    const tasks: Array<() => Promise<void>> = [];
    const schedule: AsyncEventBusScheduler = (task) => {
      tasks.push(task);
    };

    const resolver = new MapResolver();
    const bus = new AsyncMemoryEventBus(resolver, { schedule });
    const context = createContext();
    const publishResult = await bus.publish(context, new PingEvent());
    publishResult._unsafeUnwrap();

    expect(handled).toBe(0);
    expect(tasks.length).toBe(1);

    await tasks.shift()?.();

    expect(handled).toBe(1);
  });

  it('does not retain published events when recording is disabled', async () => {
    class PingEvent implements IDomainEvent {
      readonly name = DomainEventName.tableCreated();
      readonly occurredAt = OccurredAt.now();
    }

    @EventHandler(PingEvent)
    class PingEventHandler implements IEventHandler<PingEvent> {
      async handle(
        _context: IExecutionContext,
        _event: PingEvent
      ): ReturnType<IEventHandler<PingEvent>['handle']> {
        return ok(undefined);
      }
    }
    expect(PingEventHandler).toBeDefined();

    const tasks: Array<() => Promise<void>> = [];
    const schedule: AsyncEventBusScheduler = (task) => {
      tasks.push(task);
    };

    const resolver = new MapResolver();
    const bus = new AsyncMemoryEventBus(resolver, {
      schedule,
      recordPublishedEvents: false,
    });
    const context = createContext();
    const publishResult = await bus.publish(context, new PingEvent());
    publishResult._unsafeUnwrap();

    expect(bus.events()).toEqual([]);

    await tasks.shift()?.();

    expect(bus.events()).toEqual([]);
  });

  it('records handler errors via onError', async () => {
    class FailingEvent implements IDomainEvent {
      readonly name = DomainEventName.tableCreated();
      readonly occurredAt = OccurredAt.now();
    }

    @EventHandler(FailingEvent)
    class FailingEventHandler implements IEventHandler<FailingEvent> {
      async handle(
        _context: IExecutionContext,
        _event: FailingEvent
      ): ReturnType<IEventHandler<FailingEvent>['handle']> {
        return err(domainError.unexpected({ message: 'fail' }));
      }
    }
    expect(FailingEventHandler).toBeDefined();

    const tasks: Array<() => Promise<void>> = [];
    const errors: AsyncEventBusError[] = [];
    const schedule: AsyncEventBusScheduler = (task) => {
      tasks.push(task);
    };

    const resolver = new MapResolver();
    const bus = new AsyncMemoryEventBus(resolver, {
      schedule,
      onError: (error) => errors.push(error),
    });
    const context = createContext();
    const publishResult = await bus.publish(context, new FailingEvent());
    publishResult._unsafeUnwrap();

    await tasks.shift()?.();

    expect(errors.length).toBe(1);
    expect(errors[0]?.error).toBe('fail');
  });

  it('captures execution context state when events are enqueued', async () => {
    class SnapshotEvent implements IDomainEvent {
      readonly name = DomainEventName.tableCreated();
      readonly occurredAt = OccurredAt.now();
    }

    let handledContext: IExecutionContext | undefined;

    @EventHandler(SnapshotEvent)
    class SnapshotEventHandler implements IEventHandler<SnapshotEvent> {
      async handle(
        context: IExecutionContext,
        _event: SnapshotEvent
      ): ReturnType<IEventHandler<SnapshotEvent>['handle']> {
        handledContext = context;
        return ok(undefined);
      }
    }
    expect(SnapshotEventHandler).toBeDefined();

    const tasks: Array<() => Promise<void>> = [];
    const schedule: AsyncEventBusScheduler = (task) => {
      tasks.push(task);
    };

    const duplicateTable = {
      sourceTableId: 'tblSource',
      duplicatedTableId: 'tblDuplicated',
      includeRecords: true,
    };
    const context: IExecutionContext = {
      ...createContext(),
      duplicateTable,
    };
    const bus = new AsyncMemoryEventBus(new MapResolver(), { schedule });

    await bus.publishMany(context, [new SnapshotEvent()]);

    duplicateTable.includeRecords = false;
    context.duplicateTable = {
      sourceTableId: 'tblOther',
      duplicatedTableId: 'tblOtherDuplicate',
      includeRecords: false,
    };

    await tasks.shift()?.();

    expect(handledContext?.duplicateTable).toEqual({
      sourceTableId: 'tblSource',
      duplicatedTableId: 'tblDuplicated',
      includeRecords: true,
    });
  });

  it('dispatches consecutive projection handlers concurrently', async () => {
    class ProjectionEvent implements IDomainEvent {
      readonly name = DomainEventName.tableCreated();
      readonly occurredAt = OccurredAt.now();
    }

    let releaseFirstProjection!: () => void;
    const firstProjectionGate = new Promise<void>((resolve) => {
      releaseFirstProjection = resolve;
    });
    let firstStarted = false;
    let secondStarted = false;

    @ProjectionHandler(ProjectionEvent)
    class FirstConcurrentHandler implements IEventHandler<ProjectionEvent> {
      async handle(
        _context: IExecutionContext,
        _event: ProjectionEvent
      ): ReturnType<IEventHandler<ProjectionEvent>['handle']> {
        firstStarted = true;
        await firstProjectionGate;
        return ok(undefined);
      }
    }
    expect(FirstConcurrentHandler).toBeDefined();

    @ProjectionHandler(ProjectionEvent)
    class SecondConcurrentHandler implements IEventHandler<ProjectionEvent> {
      async handle(
        _context: IExecutionContext,
        _event: ProjectionEvent
      ): ReturnType<IEventHandler<ProjectionEvent>['handle']> {
        secondStarted = true;
        return ok(undefined);
      }
    }
    expect(SecondConcurrentHandler).toBeDefined();

    const tasks: Array<() => Promise<void>> = [];
    const schedule: AsyncEventBusScheduler = (task) => {
      tasks.push(task);
    };

    const bus = new AsyncMemoryEventBus(new MapResolver(), { schedule });
    await bus.publish(createContext(), new ProjectionEvent());

    const drainTask = tasks.shift();
    expect(drainTask).toBeDefined();

    const drainPromise = drainTask?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(firstStarted).toBe(true);
    expect(secondStarted).toBe(true);

    releaseFirstProjection();
    await drainPromise;
  });

  it('dispatches large batch projections serially to limit peak memory', async () => {
    class LargeBatchProjectionEvent implements IDomainEvent {
      readonly name = DomainEventName.recordsBatchUpdated();
      readonly occurredAt = OccurredAt.now();
      readonly updates = Array.from({ length: 1001 }, (_, index) => ({ recordId: `${index}` }));
    }

    let releaseFirstProjection!: () => void;
    const firstProjectionGate = new Promise<void>((resolve) => {
      releaseFirstProjection = resolve;
    });
    let firstStarted = false;
    let secondStarted = false;

    @ProjectionHandler(LargeBatchProjectionEvent)
    class FirstLargeBatchHandler implements IEventHandler<LargeBatchProjectionEvent> {
      async handle(
        _context: IExecutionContext,
        _event: LargeBatchProjectionEvent
      ): ReturnType<IEventHandler<LargeBatchProjectionEvent>['handle']> {
        firstStarted = true;
        await firstProjectionGate;
        return ok(undefined);
      }
    }
    expect(FirstLargeBatchHandler).toBeDefined();

    @ProjectionHandler(LargeBatchProjectionEvent)
    class SecondLargeBatchHandler implements IEventHandler<LargeBatchProjectionEvent> {
      async handle(
        _context: IExecutionContext,
        _event: LargeBatchProjectionEvent
      ): ReturnType<IEventHandler<LargeBatchProjectionEvent>['handle']> {
        secondStarted = true;
        return ok(undefined);
      }
    }
    expect(SecondLargeBatchHandler).toBeDefined();

    const tasks: Array<() => Promise<void>> = [];
    const schedule: AsyncEventBusScheduler = (task) => {
      tasks.push(task);
    };

    const bus = new AsyncMemoryEventBus(new MapResolver(), { schedule });
    await bus.publish(createContext(), new LargeBatchProjectionEvent());

    const drainTask = tasks.shift();
    expect(drainTask).toBeDefined();

    const drainPromise = drainTask?.();
    await waitForPredicate(() => firstStarted);

    expect(firstStarted).toBe(true);
    expect(secondStarted).toBe(false);

    releaseFirstProjection();
    await drainPromise;

    expect(secondStarted).toBe(true);
  });

  it('keeps threshold-sized batch projections concurrent', async () => {
    class ThresholdBatchProjectionEvent implements IDomainEvent {
      readonly name = DomainEventName.recordsBatchUpdated();
      readonly occurredAt = OccurredAt.now();
      readonly updates = Array.from({ length: 1000 }, (_, index) => ({ recordId: `${index}` }));
    }

    let releaseFirstProjection!: () => void;
    const firstProjectionGate = new Promise<void>((resolve) => {
      releaseFirstProjection = resolve;
    });
    let firstStarted = false;
    let secondStarted = false;

    @ProjectionHandler(ThresholdBatchProjectionEvent)
    class FirstThresholdBatchHandler implements IEventHandler<ThresholdBatchProjectionEvent> {
      async handle(
        _context: IExecutionContext,
        _event: ThresholdBatchProjectionEvent
      ): ReturnType<IEventHandler<ThresholdBatchProjectionEvent>['handle']> {
        firstStarted = true;
        await firstProjectionGate;
        return ok(undefined);
      }
    }
    expect(FirstThresholdBatchHandler).toBeDefined();

    @ProjectionHandler(ThresholdBatchProjectionEvent)
    class SecondThresholdBatchHandler implements IEventHandler<ThresholdBatchProjectionEvent> {
      async handle(
        _context: IExecutionContext,
        _event: ThresholdBatchProjectionEvent
      ): ReturnType<IEventHandler<ThresholdBatchProjectionEvent>['handle']> {
        secondStarted = true;
        return ok(undefined);
      }
    }
    expect(SecondThresholdBatchHandler).toBeDefined();

    const tasks: Array<() => Promise<void>> = [];
    const schedule: AsyncEventBusScheduler = (task) => {
      tasks.push(task);
    };

    const bus = new AsyncMemoryEventBus(new MapResolver(), { schedule });
    await bus.publish(createContext(), new ThresholdBatchProjectionEvent());

    const drainTask = tasks.shift();
    expect(drainTask).toBeDefined();

    const drainPromise = drainTask?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(firstStarted).toBe(true);
    expect(secondStarted).toBe(true);

    releaseFirstProjection();
    await drainPromise;
  });

  it('tags projection handlers and projection groups with dedicated tracing spans', async () => {
    class TracedProjectionEvent implements IDomainEvent {
      readonly name = DomainEventName.recordsBatchCreated();
      readonly occurredAt = OccurredAt.now();
      readonly records = [{ recordId: 'rec1' }];
    }

    @ProjectionHandler(TracedProjectionEvent)
    class TracedProjectionHandler implements IEventHandler<TracedProjectionEvent> {
      async handle(
        _context: IExecutionContext,
        _event: TracedProjectionEvent
      ): ReturnType<IEventHandler<TracedProjectionEvent>['handle']> {
        return ok(undefined);
      }
    }
    expect(TracedProjectionHandler).toBeDefined();

    const tracer = new FakeTracer();
    const tasks: Array<() => Promise<void>> = [];
    const schedule: AsyncEventBusScheduler = (task) => {
      tasks.push(task);
    };

    const bus = new AsyncMemoryEventBus(new MapResolver(), { schedule });
    await bus.publish(createContext(tracer), new TracedProjectionEvent());
    const drainTask = tasks.shift();
    expect(drainTask).toBeDefined();
    await drainTask?.();

    const groupSpan = tracer.spans.find(
      (span) => span.name === 'teable.AsyncMemoryEventBus.projectionGroup'
    );
    expect(groupSpan?.attributes).toMatchObject({
      [TeableSpanAttributes.COMPONENT]: 'projection',
      [TeableSpanAttributes.EVENT_NAME]: 'RecordsBatchCreated',
      [TeableSpanAttributes.EVENT_ROLE]: 'projection',
      [TeableSpanAttributes.EVENT_GROUP_MODE]: 'concurrent',
      [TeableSpanAttributes.EVENT_HANDLER_COUNT]: 1,
      [TeableSpanAttributes.EVENT_ASYNC]: true,
    });

    const handlerSpan = tracer.spans.find((span) =>
      span.name.includes('TracedProjectionHandler.handle')
    );
    expect(handlerSpan?.attributes).toMatchObject({
      [TeableSpanAttributes.COMPONENT]: 'projection',
      [TeableSpanAttributes.EVENT_NAME]: 'RecordsBatchCreated',
      [TeableSpanAttributes.EVENT_ROLE]: 'projection',
      [TeableSpanAttributes.EVENT_ASYNC]: true,
    });
    expect(handlerSpan?.parentName).toBe('teable.AsyncMemoryEventBus.projectionGroup');
  });

  it('preserves handler ordering boundaries around non-projection handlers', async () => {
    class MixedEvent implements IDomainEvent {
      readonly name = DomainEventName.tableCreated();
      readonly occurredAt = OccurredAt.now();
    }

    let blockingHandlerStarted = false;
    let trailingProjectionStarted = false;
    let releaseBlockingHandler!: () => void;
    const blockingHandlerGate = new Promise<void>((resolve) => {
      releaseBlockingHandler = resolve;
    });

    @ProjectionHandler(MixedEvent)
    class LeadingConcurrentHandler implements IEventHandler<MixedEvent> {
      async handle(
        _context: IExecutionContext,
        _event: MixedEvent
      ): ReturnType<IEventHandler<MixedEvent>['handle']> {
        return ok(undefined);
      }
    }
    expect(LeadingConcurrentHandler).toBeDefined();

    @EventHandler(MixedEvent)
    class BlockingEventHandler implements IEventHandler<MixedEvent> {
      async handle(
        _context: IExecutionContext,
        _event: MixedEvent
      ): ReturnType<IEventHandler<MixedEvent>['handle']> {
        blockingHandlerStarted = true;
        await blockingHandlerGate;
        return ok(undefined);
      }
    }
    expect(BlockingEventHandler).toBeDefined();

    @ProjectionHandler(MixedEvent)
    class TrailingConcurrentHandler implements IEventHandler<MixedEvent> {
      async handle(
        _context: IExecutionContext,
        _event: MixedEvent
      ): ReturnType<IEventHandler<MixedEvent>['handle']> {
        trailingProjectionStarted = true;
        return ok(undefined);
      }
    }
    expect(TrailingConcurrentHandler).toBeDefined();

    const tasks: Array<() => Promise<void>> = [];
    const schedule: AsyncEventBusScheduler = (task) => {
      tasks.push(task);
    };

    const bus = new AsyncMemoryEventBus(new MapResolver(), { schedule });
    await bus.publish(createContext(), new MixedEvent());

    const drainTask = tasks.shift();
    expect(drainTask).toBeDefined();

    const drainPromise = drainTask?.();
    await waitForPredicate(() => blockingHandlerStarted);

    expect(blockingHandlerStarted).toBe(true);
    expect(trailingProjectionStarted).toBe(false);

    releaseBlockingHandler();
    await drainPromise;

    expect(trailingProjectionStarted).toBe(true);
  });
});

describe('MemoryTableRepository', () => {
  it('stores and queries tables', async () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const tableNameResult = TableName.create('Memory');
    const fieldNameResult = FieldName.create('Title');
    [baseIdResult, tableNameResult, fieldNameResult].forEach((r) => r._unsafeUnwrap());

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();
    const tableResult = builder.build();
    tableResult._unsafeUnwrap();

    const repo = new MemoryTableRepository();
    const context = createContext();
    const insertResult = await repo.insert(context, tableResult._unsafeUnwrap());
    insertResult._unsafeUnwrap();
    const duplicateResult = await repo.insert(context, tableResult._unsafeUnwrap());
    duplicateResult._unsafeUnwrapErr();

    const findResult = await repo.findOne(context, {
      isSatisfiedBy: (table) => table.id().equals(tableResult._unsafeUnwrap().id()),
      mutate: (table) => ok(table),
      accept: () => ok(undefined),
    });
    findResult._unsafeUnwrap();

    const missResult = await repo.findOne(context, {
      isSatisfiedBy: () => false,
      mutate: (table) => ok(table),
      accept: () => ok(undefined),
    });
    missResult._unsafeUnwrapErr();
  });

  it('sorts and paginates results', async () => {
    const baseId = BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap();
    const tableNameA = TableName.create('Alpha')._unsafeUnwrap();
    const tableNameB = TableName.create('Beta')._unsafeUnwrap();
    const fieldName = FieldName.create('Title')._unsafeUnwrap();

    const buildTable = (name: TableName) => {
      const builder = Table.builder().withBaseId(baseId).withName(name);
      builder.field().singleLineText().withName(fieldName).done();
      builder.view().defaultGrid().done();
      return builder.build()._unsafeUnwrap();
    };

    const tableA = buildTable(tableNameA);
    const tableB = buildTable(tableNameB);

    const repo = new MemoryTableRepository();
    const context = createContext();
    await repo.insert(context, tableA);
    await repo.insert(context, tableB);

    const sortResult = Sort.create([{ key: TableSortKey.name(), direction: SortDirection.desc() }]);
    sortResult._unsafeUnwrap();

    const limitResult = PageLimit.create(1);
    const offsetResult = PageOffset.create(1);
    [limitResult, offsetResult].forEach((r) => r._unsafeUnwrap());

    const pagination = OffsetPagination.create(
      limitResult._unsafeUnwrap(),
      offsetResult._unsafeUnwrap()
    );

    const allSpec = {
      isSatisfiedBy: () => true,
      mutate: (table: Table) => ok(table),
      accept: () => ok(undefined),
    };

    const sortedResult = await repo.find(context, allSpec, {
      sort: sortResult._unsafeUnwrap(),
      pagination,
    });
    sortedResult._unsafeUnwrap();

    expect(sortedResult._unsafeUnwrap().length).toBe(1);
    expect(sortedResult._unsafeUnwrap()[0]?.name().toString()).toBe('Alpha');

    const bogusSortResult = Sort.create([
      {
        key: { toString: () => 'unknown' } as unknown as TableSortKey,
        direction: SortDirection.asc(),
      },
    ]);
    bogusSortResult._unsafeUnwrap();

    const bogusResult = await repo.find(context, allSpec, {
      sort: bogusSortResult._unsafeUnwrap(),
    });
    bogusResult._unsafeUnwrap();

    expect(bogusResult._unsafeUnwrap().map((table) => table.name().toString())).toEqual([
      'Alpha',
      'Beta',
    ]);
  });
});
