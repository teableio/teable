import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { CommandHandler, type ICommandHandler } from '../../commands/CommandHandler';
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
import type { AsyncEventBusError, AsyncEventBusScheduler } from './AsyncMemoryEventBus';
import { AsyncMemoryEventBus } from './AsyncMemoryEventBus';
import { MemoryCommandBus } from './MemoryCommandBus';
import { MemoryEventBus } from './MemoryEventBus';
import { MemoryQueryBus } from './MemoryQueryBus';
import { MemoryTableRepository } from './MemoryTableRepository';

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

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

describe('MemoryCommandBus', () => {
  it('executes command handlers', async () => {
    class PingCommand {}

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
    class MissingCommand {}
    const bus = new MemoryCommandBus(new MapResolver());
    const result = await bus.execute(createContext(), new MissingCommand());
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toContain('Missing command handler');
  });

  it('handles handler exceptions and middleware errors', async () => {
    class CrashCommand {}

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
