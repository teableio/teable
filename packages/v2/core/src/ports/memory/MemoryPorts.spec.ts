import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { CommandHandler, type ICommandHandler } from '../../commands/CommandHandler';
import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { DomainEventName } from '../../domain/shared/DomainEventName';
import { OccurredAt } from '../../domain/shared/OccurredAt';
import { FieldName } from '../../domain/table/fields/FieldName';
import { Table } from '../../domain/table/Table';
import { TableName } from '../../domain/table/TableName';
import { QueryHandler, type IQueryHandler } from '../../queries/QueryHandler';
import type { ICommandBusMiddleware } from '../CommandBus';
import { EventHandler, type IEventHandler } from '../EventHandler';
import type { IExecutionContext } from '../ExecutionContext';
import type { IHandlerResolver, IClassToken } from '../HandlerResolver';
import type { IQueryBusMiddleware } from '../QueryBus';
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
  const actorIdResult = ActorId.create('system');
  expect(actorIdResult.isOk()).toBe(true);
  if (actorIdResult.isErr()) {
    throw new Error('ActorId required for tests');
  }
  return { actorId: actorIdResult.value };
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
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toBe('pong');
  });

  it('returns error when handler is missing', async () => {
    class MissingCommand {}
    const bus = new MemoryCommandBus(new MapResolver());
    const result = await bus.execute(createContext(), new MissingCommand());
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('Missing command handler');
    }
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
    expect(handlerResult.isErr()).toBe(true);
    if (handlerResult.isErr()) {
      expect(handlerResult.error).toContain('boom');
    }

    const busWithMiddleware = new MemoryCommandBus(resolver, [middleware]);
    const middlewareResult = await busWithMiddleware.execute(createContext(), new CrashCommand());
    expect(middlewareResult.isErr()).toBe(true);
    if (middlewareResult.isErr()) {
      expect(middlewareResult.error).toContain('middleware');
    }
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
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toBe('pong');
  });

  it('returns error when handler is missing', async () => {
    class MissingQuery {}
    const bus = new MemoryQueryBus(new MapResolver());
    const result = await bus.execute(createContext(), new MissingQuery());
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('Missing query handler');
    }
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
    expect(handlerResult.isErr()).toBe(true);
    if (handlerResult.isErr()) {
      expect(handlerResult.error).toContain('boom');
    }

    const busWithMiddleware = new MemoryQueryBus(resolver, [middleware]);
    const middlewareResult = await busWithMiddleware.execute(createContext(), new CrashQuery());
    expect(middlewareResult.isErr()).toBe(true);
    if (middlewareResult.isErr()) {
      expect(middlewareResult.error).toContain('middleware');
    }
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
    expect(publishResult.isOk()).toBe(true);
    expect(bus.events().length).toBe(1);
    expect(handled).toBe(1);

    const publishManyResult = await bus.publishMany(context, [event]);
    expect(publishManyResult.isOk()).toBe(true);
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
        return err('fail');
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
    expect(failResult.isErr()).toBe(true);
    if (failResult.isErr()) {
      expect(failResult.error).toBe('fail');
    }

    const throwResult = await bus.publish(context, new ThrowingEvent());
    expect(throwResult.isErr()).toBe(true);
    if (throwResult.isErr()) {
      expect(throwResult.error).toContain('boom');
    }
  });
});

describe('MemoryTableRepository', () => {
  it('stores and queries tables', async () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const tableNameResult = TableName.create('Memory');
    const fieldNameResult = FieldName.create('Title');
    expect([baseIdResult, tableNameResult, fieldNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || tableNameResult.isErr() || fieldNameResult.isErr()) return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(fieldNameResult.value).done();
    builder.view().defaultGrid().done();
    const tableResult = builder.build();
    expect(tableResult.isOk()).toBe(true);
    if (tableResult.isErr()) return;

    const repo = new MemoryTableRepository();
    const context = createContext();
    const insertResult = await repo.insert(context, tableResult.value);
    expect(insertResult.isOk()).toBe(true);
    const duplicateResult = await repo.insert(context, tableResult.value);
    expect(duplicateResult.isErr()).toBe(true);

    const findResult = await repo.findOne(context, {
      isSatisfiedBy: (table) => table.id().equals(tableResult.value.id()),
      mutate: (table) => ok(table),
      accept: () => ok(undefined),
    });
    expect(findResult.isOk()).toBe(true);

    const missResult = await repo.findOne(context, {
      isSatisfiedBy: () => false,
      mutate: (table) => ok(table),
      accept: () => ok(undefined),
    });
    expect(missResult.isErr()).toBe(true);
  });
});
