import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
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
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { RenameTableCommand } from './RenameTableCommand';
import { RenameTableHandler } from './RenameTableHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = (baseIdSeed: string, name: string): Table => {
  const baseId = BaseId.create(`bse${baseIdSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create(name)._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = TableAggregate.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  updated: Table[] = [];
  failUpdate: DomainError | undefined;

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
    targetTable: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    if (this.failUpdate) return err(this.failUpdate);
    let updated = false;
    this.tables = this.tables.map((current) => {
      if (!current.id().equals(targetTable.id())) return current;
      const mutateResult = mutateSpec.mutate(current);
      const updatedTable = mutateResult._unsafeUnwrap();
      updated = true;
      this.updated.push(updatedTable);
      return updatedTable;
    });
    if (!updated) return err(domainError.notFound({ message: 'Not found' }));
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
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

class FakeTableSchemaRepository implements ITableSchemaRepository {
  updates: Table[] = [];

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
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    this.updates.push(table);
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
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

describe('RenameTableHandler', () => {
  it('renames tables and publishes events', async () => {
    const table = buildTable('a', 'Old Name');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const flow = new TableUpdateFlow(repo, schemaRepo, eventBus, unitOfWork);

    const commandResult = RenameTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      name: 'New Name',
    });

    const handler = new RenameTableHandler(flow);
    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());

    expect(repo.updated).toHaveLength(1);
    expect(result._unsafeUnwrap().table.name().toString()).toBe('New Name');
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
      )
    );

    const commandResult = RenameTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      name: 'Renamed',
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toBe('Table not found');
  });
});
