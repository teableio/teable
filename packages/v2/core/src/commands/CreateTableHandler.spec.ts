import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../domain/shared/ActorId';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { Table } from '../domain/table/Table';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { ILogger } from '../ports/Logger';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { CreateTableCommand } from './CreateTableCommand';
import { CreateTableHandler } from './CreateTableHandler';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  expect(actorIdResult.isOk()).toBe(true);
  if (actorIdResult.isErr()) throw new Error('ActorId required for tests');
  return { actorId: actorIdResult.value };
};

class FakeTableRepository implements ITableRepository {
  inserted: Table[] = [];
  lastContext: IExecutionContext | undefined;
  failInsert: string | undefined;

  async insert(context: IExecutionContext, table: Table) {
    this.lastContext = context;
    if (this.failInsert) return err(this.failInsert);
    this.inserted.push(table);
    return ok(table);
  }

  async findOne(
    _context: IExecutionContext,
    _spec: ISpecification<Table>
  ): Promise<Result<Table, string>> {
    return err('Not implemented');
  }

  async find(
    _context: IExecutionContext,
    _spec: ISpecification<Table>,
    _options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, string>> {
    return ok([]);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  inserted: Table[] = [];
  lastContext: IExecutionContext | undefined;
  failInsert: string | undefined;

  async insert(context: IExecutionContext, table: Table) {
    this.lastContext = context;
    if (this.failInsert) return err(this.failInsert);
    this.inserted.push(table);
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];
  failPublish: string | undefined;

  async publish(_context: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    if (this.failPublish) return err(this.failPublish);
    return ok(undefined);
  }

  async publishMany(_context: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    this.published.push(...events);
    if (this.failPublish) return err(this.failPublish);
    return ok(undefined);
  }
}

class FakeLogger implements ILogger {
  readonly messages: string[] = [];

  debug(message: string): void {
    this.messages.push(message);
  }

  info(message: string): void {
    this.messages.push(message);
  }

  warn(message: string): void {
    this.messages.push(message);
  }

  error(message: string): void {
    this.messages.push(message);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  transactions: IExecutionContext[] = [];

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, string>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    const transactionContext = { ...context, transaction };
    this.transactions.push(transactionContext);
    return work(transactionContext);
  }
}

const createCommand = (baseIdSeed: string) => {
  return CreateTableCommand.create({
    baseId: `bse${baseIdSeed.repeat(16)}`,
    name: 'Command Table',
    fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
};

describe('CreateTableHandler', () => {
  it('builds tables and publishes events', async () => {
    const commandResult = createCommand('a');
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const logger = new FakeLogger();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new CreateTableHandler(
      tableRepository,
      schemaRepository,
      eventBus,
      logger,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult.value);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(tableRepository.inserted.length).toBe(1);
    expect(schemaRepository.inserted.length).toBe(1);
    expect(eventBus.published.length).toBeGreaterThan(0);
    expect(unitOfWork.transactions.length).toBe(1);
    expect(tableRepository.lastContext?.transaction?.kind).toBe('unitOfWorkTransaction');
  });

  it('returns errors from repositories and event bus', async () => {
    const commandResult = createCommand('b');
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const tableRepository = new FakeTableRepository();
    tableRepository.failInsert = 'insert failed';
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const logger = new FakeLogger();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new CreateTableHandler(
      tableRepository,
      schemaRepository,
      eventBus,
      logger,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult.value);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe('insert failed');
    }

    tableRepository.failInsert = undefined;
    schemaRepository.failInsert = 'schema failed';
    const schemaResult = await handler.handle(createContext(), commandResult.value);
    expect(schemaResult.isErr()).toBe(true);
    if (schemaResult.isErr()) {
      expect(schemaResult.error).toBe('schema failed');
    }

    schemaRepository.failInsert = undefined;
    eventBus.failPublish = 'publish failed';
    const publishResult = await handler.handle(createContext(), commandResult.value);
    expect(publishResult.isErr()).toBe(true);
    if (publishResult.isErr()) {
      expect(publishResult.error).toBe('publish failed');
    }
  });

  it('fails when the command produces an invalid table', async () => {
    const commandResult = CreateTableCommand.create({
      baseId: `bse${'c'.repeat(16)}`,
      name: 'Invalid Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Title' },
      ],
      views: [{ type: 'grid' }],
    });
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const handler = new CreateTableHandler(
      new FakeTableRepository(),
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const result = await handler.handle(createContext(), commandResult.value);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('Field names must be unique');
    }
  });
});
