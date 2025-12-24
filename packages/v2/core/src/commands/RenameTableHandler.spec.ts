import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { TableRenamed } from '../domain/table/events/TableRenamed';
import { FieldName } from '../domain/table/fields/FieldName';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { ILogger } from '../ports/Logger';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { RenameTableCommand } from './RenameTableCommand';
import { RenameTableHandler } from './RenameTableHandler';
import { TableUpdateFlow } from './TableUpdateFlow';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  expect(actorIdResult.isOk()).toBe(true);
  if (actorIdResult.isErr()) throw new Error('ActorId required for tests');
  return { actorId: actorIdResult.value };
};

const buildTable = (baseIdSeed: string, name: string): Table => {
  const baseIdResult = BaseId.create(`bse${baseIdSeed.repeat(16)}`);
  const tableNameResult = TableName.create(name);
  const fieldNameResult = FieldName.create('Title');
  expect([baseIdResult, tableNameResult, fieldNameResult].every((r) => r.isOk())).toBe(true);
  if (baseIdResult.isErr() || tableNameResult.isErr() || fieldNameResult.isErr()) {
    throw new Error('Failed to build table');
  }

  const builder = TableAggregate.builder()
    .withBaseId(baseIdResult.value)
    .withName(tableNameResult.value);
  builder.field().singleLineText().withName(fieldNameResult.value).done();
  builder.view().defaultGrid().done();
  const buildResult = builder.build();
  expect(buildResult.isOk()).toBe(true);
  if (buildResult.isErr()) throw new Error('Failed to build table');
  return buildResult.value;
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  updated: Table[] = [];
  failUpdate: string | undefined;

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, string>> {
    this.tables.push(table);
    return ok(table);
  }

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, string>> {
    const found = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!found) return err('Not found');
    return ok(found);
  }

  async find(
    _: IExecutionContext,
    __: ISpecification<Table, ITableSpecVisitor>,
    ___?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, string>> {
    return ok([]);
  }

  async updateOne(
    _: IExecutionContext,
    targetTable: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, string>> {
    if (this.failUpdate) return err(this.failUpdate);
    let updated = false;
    this.tables = this.tables.map((current) => {
      if (!current.id().equals(targetTable.id())) return current;
      const mutateResult = mutateSpec.mutate(current);
      if (mutateResult.isErr()) {
        throw new Error(mutateResult.error);
      }
      updated = true;
      this.updated.push(mutateResult.value);
      return mutateResult.value;
    });
    if (!updated) return err('Not found');
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, string>> {
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

class FakeTableSchemaRepository implements ITableSchemaRepository {
  updates: Table[] = [];

  async insert(_: IExecutionContext, __: Table): Promise<Result<void, string>> {
    return ok(undefined);
  }

  async update(
    _: IExecutionContext,
    table: Table,
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, string>> {
    this.updates.push(table);
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, string>> {
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

describe('RenameTableHandler', () => {
  it('renames tables and publishes events', async () => {
    const table = buildTable('a', 'Old Name');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const logger = new FakeLogger();
    const unitOfWork = new FakeUnitOfWork();
    const flow = new TableUpdateFlow(repo, schemaRepo, eventBus, unitOfWork);

    const commandResult = RenameTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      name: 'New Name',
    });
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const handler = new RenameTableHandler(flow, logger);
    const result = await handler.handle(createContext(), commandResult.value);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(repo.updated).toHaveLength(1);
    expect(result.value.table.name().toString()).toBe('New Name');
    expect(eventBus.published.some((event) => event instanceof TableRenamed)).toBe(true);
    expect(unitOfWork.transactions.length).toBe(1);
  });

  it('returns not found when table is missing', async () => {
    const table = buildTable('b', 'Missing');
    const repo = new FakeTableRepository();
    const handler = new RenameTableHandler(
      new TableUpdateFlow(
        repo,
        new FakeTableSchemaRepository(),
        new FakeEventBus(),
        new FakeUnitOfWork()
      ),
      new FakeLogger()
    );

    const commandResult = RenameTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      name: 'Renamed',
    });
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const result = await handler.handle(createContext(), commandResult.value);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe('Table not found');
    }
  });
});
