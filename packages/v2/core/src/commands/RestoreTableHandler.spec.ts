import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableQueryService } from '../application/services/TableQueryService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { TableRestored } from '../domain/table/events/TableRestored';
import { FieldName } from '../domain/table/fields/FieldName';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type {
  IExecutionContext,
  IUnitOfWorkTransaction,
  UnitOfWorkScope,
} from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository, TableProvisionState } from '../ports/TableRepository';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { RestoreTableCommand } from './RestoreTableCommand';
import { RestoreTableHandler } from './RestoreTableHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = (baseIdSeed: string): Table => {
  const baseId = BaseId.create(`bse${baseIdSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Restore Me')._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = TableAggregate.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  deletedTableIds = new Set<string>();
  restored: Table[] = [];
  provisionStateChanges: Array<{ tableId: string; state: TableProvisionState }> = [];
  failRestore: DomainError | undefined;

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
    options?: { state?: 'active' | 'deleted' | 'all' }
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

  async updateOne(): Promise<Result<void, DomainError>> {
    return err(domainError.notImplemented({ message: 'Not implemented' }));
  }

  async restore(_: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    if (this.failRestore) return err(this.failRestore);
    if (!this.deletedTableIds.has(table.id().toString())) {
      return err(domainError.notFound({ message: 'Not found' }));
    }
    this.deletedTableIds.delete(table.id().toString());
    this.restored.push(table);
    this.provisionStateChanges.push({ tableId: table.id().toString(), state: 'ready' });
    return ok(undefined);
  }

  async delete(_: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    this.deletedTableIds.add(table.id().toString());
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];

  async publish(_context: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(_context: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    this.published.push(...events);
    return ok(undefined);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  transactions: IExecutionContext[] = [];

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    const scope: UnitOfWorkScope = options?.scope ?? 'data';
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction', scope };
    const transactionContext = {
      ...context,
      transaction,
      transactions: {
        ...(context.transactions ?? {}),
        [scope]: transaction,
      },
    };
    this.transactions.push(transactionContext);
    return work(transactionContext);
  }
}

describe('RestoreTableHandler', () => {
  it('restores deleted tables and publishes TableRestored', async () => {
    const table = buildTable('a');
    table.pullDomainEvents();
    const repository = new FakeTableRepository();
    repository.tables.push(table);
    repository.deletedTableIds.add(table.id().toString());
    const tableQueryService = new TableQueryService(repository);
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const command = RestoreTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    })._unsafeUnwrap();

    const handler = new RestoreTableHandler(tableQueryService, repository, eventBus, unitOfWork);
    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrap().table.id().toString()).toBe(table.id().toString());
    expect(repository.restored).toHaveLength(1);
    expect(repository.provisionStateChanges.map(({ state }) => state)).toEqual(['ready']);
    expect(unitOfWork.transactions).toHaveLength(1);
    expect(unitOfWork.transactions[0]?.transaction?.scope).toBe('meta');
    expect(eventBus.published).toHaveLength(1);
    expect(eventBus.published[0]).toBeInstanceOf(TableRestored);
  });

  it('returns not found when the table is not soft deleted', async () => {
    const table = buildTable('b');
    table.pullDomainEvents();
    const repository = new FakeTableRepository();
    repository.tables.push(table);
    const tableQueryService = new TableQueryService(repository);
    const handler = new RestoreTableHandler(
      tableQueryService,
      repository,
      new FakeEventBus(),
      new FakeUnitOfWork()
    );
    const command = RestoreTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrapErr().code).toBe('table.not_found');
  });

  it('propagates restore persistence errors', async () => {
    const table = buildTable('c');
    table.pullDomainEvents();
    const repository = new FakeTableRepository();
    repository.tables.push(table);
    repository.deletedTableIds.add(table.id().toString());
    repository.failRestore = domainError.infrastructure({ message: 'restore failed' });
    const tableQueryService = new TableQueryService(repository);
    const handler = new RestoreTableHandler(
      tableQueryService,
      repository,
      new FakeEventBus(),
      new FakeUnitOfWork()
    );
    const command = RestoreTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrapErr().message).toBe('restore failed');
  });
});
