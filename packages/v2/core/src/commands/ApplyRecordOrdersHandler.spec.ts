import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableQueryService } from '../application/services/TableQueryService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldName } from '../domain/table/fields/FieldName';
import type { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  BatchRecordMutationResult,
  ITableRecordRepository,
  RecordMutationResult,
  UpdateManyStreamResult,
} from '../ports/TableRecordRepository';
import type {
  ITableRecordQueryRepository,
  ITableRecordQueryResult,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { ApplyRecordOrdersCommand } from './ApplyRecordOrdersCommand';
import { ApplyRecordOrdersHandler } from './ApplyRecordOrdersHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'j'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'k'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Apply Orders')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  return { table, viewId: table.views()[0]!.id() };
};

const createCommand = (
  tableId: string,
  viewId: string,
  records: Array<{ recordId: string; order?: number | null }>
) =>
  ApplyRecordOrdersCommand.create({
    tableId,
    viewId,
    records,
  })._unsafeUnwrap();

class FakeTableRepository implements ITableRepository {
  constructor(private readonly tables: Table[]) {}

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(tables);
  }

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const table = this.tables.find((candidate) => spec.isSatisfiedBy(candidate));
    return table ? ok(table) : err(domainError.notFound({ message: 'Table not found' }));
  }

  async find(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    __?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  updateBatches: ReadonlyArray<ReadonlyArray<RecordUpdateResult>> = [];

  async insert(): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertMany(): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertManyStream(): Promise<Result<{ totalInserted: number }, DomainError>> {
    return ok({ totalInserted: 0 });
  }

  async updateOne(): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async updateMany(): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return ok({});
  }

  async updateManyStream(
    _: IExecutionContext,
    __: Table,
    updates: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    const batches: ReadonlyArray<RecordUpdateResult>[] = [];
    for (const batchResult of updates) {
      if (batchResult.isErr()) {
        return err(batchResult.error);
      }
      batches.push(batchResult.value);
    }
    this.updateBatches = batches;
    return ok({ totalUpdated: batches.flat().length, updatedRecords: [] });
  }

  async deleteMany() {
    return ok({});
  }
}

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  constructor(private readonly result: Result<ITableRecordQueryResult, DomainError>) {}

  async find(): Promise<Result<ITableRecordQueryResult, DomainError>> {
    return this.result;
  }

  async findOne(): Promise<Result<TableRecordReadModel, DomainError>> {
    return err(domainError.notFound({ message: 'Not implemented' }));
  }

  async *findStream(): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    return;
  }
}

class FakeEventBus implements IEventBus {
  publishedMany: ReadonlyArray<IDomainEvent>[] = [];

  async publish(_: IExecutionContext, __: IDomainEvent): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async publishMany(
    _: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    this.publishedMany.push(events);
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

describe('ApplyRecordOrdersHandler', () => {
  it('applies orders, updates records, and publishes reordered event', async () => {
    const { table, viewId } = buildTable();
    const recordIds = [`rec${'l'.repeat(14)}01`, `rec${'m'.repeat(14)}02`];
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const handler = new ApplyRecordOrdersHandler(
      new TableQueryService(new FakeTableRepository([table])),
      tableRecordRepository,
      new FakeTableRecordQueryRepository(
        ok({
          records: [
            { id: recordIds[0], orders: { [viewId.toString()]: 1 } },
            { id: recordIds[1], orders: { [viewId.toString()]: 2 } },
          ] as unknown as TableRecordReadModel[],
          total: 2,
        })
      ),
      eventBus,
      new FakeUnitOfWork()
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), viewId.toString(), [
        { recordId: recordIds[0], order: 10 },
        { recordId: recordIds[1], order: 11 },
      ])
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedRecordIds).toEqual(recordIds);
    expect(tableRecordRepository.updateBatches).toHaveLength(1);
    expect(tableRecordRepository.updateBatches[0]).toHaveLength(2);
    expect(eventBus.publishedMany).toHaveLength(1);
    expect(eventBus.publishedMany[0]).toHaveLength(1);
  });

  it('returns early when no record has a numeric order', async () => {
    const { table, viewId } = buildTable();
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const handler = new ApplyRecordOrdersHandler(
      new TableQueryService(new FakeTableRepository([table])),
      tableRecordRepository,
      new FakeTableRecordQueryRepository(ok({ records: [], total: 0 })),
      eventBus,
      unitOfWork
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), viewId.toString(), [
        { recordId: `rec${'n'.repeat(14)}01`, order: null },
        { recordId: `rec${'o'.repeat(14)}02` },
      ])
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedRecordIds).toEqual([]);
    expect(tableRecordRepository.updateBatches).toHaveLength(0);
    expect(eventBus.publishedMany).toHaveLength(0);
    expect(unitOfWork.transactions).toHaveLength(0);
  });

  it('propagates previous order lookup failures without writing updates', async () => {
    const { table, viewId } = buildTable();
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const handler = new ApplyRecordOrdersHandler(
      new TableQueryService(new FakeTableRepository([table])),
      tableRecordRepository,
      new FakeTableRecordQueryRepository(
        err(
          domainError.infrastructure({
            code: 'apply.orders_lookup_failed',
            message: 'lookup failed',
          })
        )
      ),
      eventBus,
      unitOfWork
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), viewId.toString(), [
        { recordId: `rec${'p'.repeat(14)}01`, order: 20 },
      ])
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('apply.orders_lookup_failed');
    expect(tableRecordRepository.updateBatches).toHaveLength(0);
    expect(eventBus.publishedMany).toHaveLength(0);
    expect(unitOfWork.transactions).toHaveLength(0);
  });

  it('returns view.not_found before processing records', async () => {
    const { table } = buildTable();
    const handler = new ApplyRecordOrdersHandler(
      new TableQueryService(new FakeTableRepository([table])),
      new FakeTableRecordRepository(),
      new FakeTableRecordQueryRepository(ok({ records: [], total: 0 })),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), `viw${'q'.repeat(16)}`, [
        { recordId: `rec${'r'.repeat(14)}01`, order: 30 },
      ])
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('view.not_found');
  });
});
