import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { TableDeleted } from '../domain/table/events/TableDeleted';
import { FieldName } from '../domain/table/fields/FieldName';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { ILogger, LogContext } from '../ports/Logger';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { DeleteTableCommand } from './DeleteTableCommand';
import { DeleteTableHandler } from './DeleteTableHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = (baseIdSeed: string): Table => {
  const baseId = BaseId.create(`bse${baseIdSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Delete Me')._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = TableAggregate.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  deleted: Table[] = [];
  failDelete: DomainError | undefined;

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    this.tables.push(table);
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    this.tables.push(...tables);
    return ok([...tables]);
  }

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const found = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!found) return err(domainError.notFound({ message: 'Not found' }));
    return ok(found);
  }

  async find(
    _: IExecutionContext,
    __: ISpecification<Table, ITableSpecVisitor>,
    ___?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok([]);
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return err(domainError.notImplemented({ message: 'Not implemented' }));
  }

  async delete(_: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    if (this.failDelete) return err(this.failDelete);
    this.deleted.push(table);
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  deleted: Table[] = [];
  failDelete: DomainError | undefined;

  async insert(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _: IExecutionContext,
    __: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async update(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    if (this.failDelete) return err(this.failDelete);
    this.deleted.push(table);
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];
  failPublish: DomainError | undefined;

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

  child(_: LogContext): ILogger {
    return this;
  }

  scope(_: string, __?: LogContext): ILogger {
    return this;
  }

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
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    const transactionContext = { ...context, transaction };
    this.transactions.push(transactionContext);
    return work(transactionContext);
  }
}

describe('DeleteTableHandler', () => {
  it('deletes tables and publishes events', async () => {
    const table = buildTable('a');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const logger = new FakeLogger();
    const unitOfWork = new FakeUnitOfWork();

    const commandResult = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    });
    commandResult._unsafeUnwrap();

    const handler = new DeleteTableHandler(repo, schemaRepo, eventBus, logger, unitOfWork);
    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(schemaRepo.deleted).toHaveLength(1);
    expect(repo.deleted).toHaveLength(1);
    expect(eventBus.published.some((event) => event instanceof TableDeleted)).toBe(true);
    expect(unitOfWork.transactions.length).toBe(1);
  });

  it('returns not found when table is missing', async () => {
    const table = buildTable('b');
    const repo = new FakeTableRepository();
    const handler = new DeleteTableHandler(
      repo,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const commandResult = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    });
    commandResult._unsafeUnwrap();

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toBe('Table not found');
  });

  it('returns errors from repositories and event bus', async () => {
    const table = buildTable('c');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();

    const handler = new DeleteTableHandler(
      repo,
      schemaRepo,
      eventBus,
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const commandResult = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    });
    commandResult._unsafeUnwrap();

    schemaRepo.failDelete = domainError.unexpected({ message: 'schema delete failed' });
    const schemaResult = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(schemaResult._unsafeUnwrapErr().message).toBe('schema delete failed');

    schemaRepo.failDelete = undefined;
    repo.failDelete = domainError.unexpected({ message: 'repo delete failed' });
    const repoResult = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(repoResult._unsafeUnwrapErr().message).toBe('repo delete failed');

    repo.failDelete = undefined;
    eventBus.failPublish = domainError.unexpected({ message: 'publish failed' });
    const publishResult = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(publishResult._unsafeUnwrapErr().message).toBe('publish failed');
  });
});
