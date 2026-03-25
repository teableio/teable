import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { TableDeletionSideEffectServiceResult } from '../application/services/TableDeletionSideEffectService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { TableActionTriggerRequested } from '../domain/table/events/TableActionTriggerRequested';
import { TableDeleted } from '../domain/table/events/TableDeleted';
import { TableTrashed } from '../domain/table/events/TableTrashed';
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
import type {
  ITableRepository,
  TableDeleteOptions,
  TableFindOptions,
} from '../ports/TableRepository';
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
  deleteModes: Array<'soft' | 'permanent'> = [];
  deletedTableIds = new Set<string>();
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
    spec: ISpecification<Table, ITableSpecVisitor>,
    options?: Pick<TableFindOptions, 'state'>
  ): Promise<Result<Table, DomainError>> {
    const state = options?.state ?? 'active';
    const found = this.tables.find((table) => {
      const isDeleted = this.deletedTableIds.has(table.id().toString());
      if (state === 'active' && isDeleted) return false;
      if (state === 'deleted' && !isDeleted) return false;
      return spec.isSatisfiedBy(table);
    });
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

  async restore(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(
    _: IExecutionContext,
    table: Table,
    options?: TableDeleteOptions
  ): Promise<Result<void, DomainError>> {
    if (this.failDelete) return err(this.failDelete);
    this.deleted.push(table);
    this.deleteModes.push(options?.mode ?? 'soft');
    this.deletedTableIds.add(table.id().toString());
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  deleted: Table[] = [];
  deleteModes: Array<'soft' | 'permanent'> = [];
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
    table: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async delete(
    _: IExecutionContext,
    table: Table,
    options?: TableDeleteOptions
  ): Promise<Result<void, DomainError>> {
    if (this.failDelete) return err(this.failDelete);
    this.deleteModes.push(options?.mode ?? 'soft');
    if ((options?.mode ?? 'soft') === 'permanent') {
      this.deleted.push(table);
    }
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

class FakeTableDeletionSideEffectService {
  events: IDomainEvent[] = [];
  postPersistEvents: IDomainEvent[] = [];
  calls = 0;
  failExecute: DomainError | undefined;

  async execute(): Promise<Result<TableDeletionSideEffectServiceResult, DomainError>> {
    this.calls += 1;
    if (this.failExecute) return err(this.failExecute);
    return ok({
      events: [...this.events],
      postPersistEvents: [...this.postPersistEvents],
      updatedTables: [],
    });
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
  it('soft deletes tables without dropping schema and publishes TableTrashed', async () => {
    const table = buildTable('a');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const sideEffectService = new FakeTableDeletionSideEffectService();
    const logger = new FakeLogger();
    const unitOfWork = new FakeUnitOfWork();

    const commandResult = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    });
    commandResult._unsafeUnwrap();

    const handler = new DeleteTableHandler(
      repo,
      schemaRepo,
      sideEffectService as never,
      eventBus,
      logger,
      unitOfWork
    );
    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(schemaRepo.deleted).toHaveLength(0);
    expect(schemaRepo.deleteModes).toEqual(['soft']);
    expect(repo.deleted).toHaveLength(1);
    expect(repo.deleteModes).toEqual(['soft']);
    expect(eventBus.published.some((event) => event instanceof TableTrashed)).toBe(true);
    expect(eventBus.published.some((event) => event instanceof TableDeleted)).toBe(false);
    expect(unitOfWork.transactions.length).toBe(1);
  });

  it('publishes side-effect post-persist events without returning them in the response payload', async () => {
    const table = buildTable('s');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const sideEffectService = new FakeTableDeletionSideEffectService();
    sideEffectService.postPersistEvents = [
      TableActionTriggerRequested.create({
        tableId: table.id(),
        baseId: table.baseId(),
        actionKey: 'setRecord',
        payload: { tableId: table.id().toString(), fieldIds: [] },
      }),
    ];

    const handler = new DeleteTableHandler(
      repo,
      schemaRepo,
      sideEffectService as never,
      eventBus,
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const payload = result._unsafeUnwrap();
    const responseEventNames = payload.events.map((event) => event.name.toString());
    const publishedEventNames = eventBus.published.map((event) => event.name.toString());

    expect(responseEventNames).not.toContain('TableActionTriggerRequested');
    expect(publishedEventNames).toContain('TableActionTriggerRequested');
    expect(publishedEventNames).toContain('TableTrashed');
  });

  it('permanently deletes tables and publishes TableDeleted', async () => {
    const table = buildTable('p');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const handler = new DeleteTableHandler(
      repo,
      schemaRepo,
      new FakeTableDeletionSideEffectService() as never,
      eventBus,
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'permanent',
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    result._unsafeUnwrap();

    expect(schemaRepo.deleted).toHaveLength(1);
    expect(schemaRepo.deleteModes).toEqual(['permanent']);
    expect(repo.deleteModes).toEqual(['permanent']);
    expect(eventBus.published.some((event) => event instanceof TableDeleted)).toBe(true);
  });

  it('permanently deletes an already trashed table without rerunning side effects', async () => {
    const table = buildTable('q');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    repo.deletedTableIds.add(table.id().toString());
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const sideEffectService = new FakeTableDeletionSideEffectService();
    const handler = new DeleteTableHandler(
      repo,
      schemaRepo,
      sideEffectService as never,
      eventBus,
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'permanent',
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    result._unsafeUnwrap();

    expect(sideEffectService.calls).toBe(0);
    expect(schemaRepo.deleteModes).toEqual(['permanent']);
    expect(repo.deleteModes).toEqual(['permanent']);
    expect(eventBus.published.some((event) => event instanceof TableDeleted)).toBe(true);
  });

  it('returns not found when table is missing', async () => {
    const table = buildTable('b');
    const repo = new FakeTableRepository();
    const handler = new DeleteTableHandler(
      repo,
      new FakeTableSchemaRepository(),
      new FakeTableDeletionSideEffectService() as never,
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
    const sideEffectService = new FakeTableDeletionSideEffectService();
    const eventBus = new FakeEventBus();

    const handler = new DeleteTableHandler(
      repo,
      schemaRepo,
      sideEffectService as never,
      eventBus,
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const commandResult = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    });
    commandResult._unsafeUnwrap();

    sideEffectService.failExecute = domainError.unexpected({ message: 'side effect failed' });
    const sideEffectResult = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(sideEffectResult._unsafeUnwrapErr().message).toBe('side effect failed');

    sideEffectService.failExecute = undefined;
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
