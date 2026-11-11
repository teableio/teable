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
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import { EventBusDomainWriteTransaction } from '../ports/memory/EventBusDomainWriteTransaction';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  ITableRecordQueryRepository,
  ITableRecordQueryResult,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type {
  BatchRecordMutationResult,
  ITableRecordRepository,
  RecordMutationResult,
  UpdateManyStreamResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { ApplyRecordOrdersCommand } from './ApplyRecordOrdersCommand';
import { ApplyRecordOrdersHandler } from './ApplyRecordOrdersHandler';
import { createRecordWritePluginRunner } from './recordWritePluginRunnerTestUtils';

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
  records: Array<{ recordId: string; order?: number | null }>,
  source?: 'recordUpdate'
) =>
  ApplyRecordOrdersCommand.create({
    tableId,
    viewId,
    records,
    source,
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

  async duplicatePhysicalRows(
    _context: any,
    _plan: any
  ): Promise<Result<{ rowCount: number; recordIds: string[] }, DomainError>> {
    return ok({ rowCount: 0, recordIds: [] });
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
    if (this.result.isErr()) {
      yield err(this.result.error);
      return;
    }
    for (const record of this.result.value.records) {
      yield ok(record);
    }
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
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), eventBus),
      createRecordWritePluginRunner()
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
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      createRecordWritePluginRunner()
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
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      createRecordWritePluginRunner()
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
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus()),
      createRecordWritePluginRunner()
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

  it.each([undefined, 'recordUpdate'] as const)(
    'enforces record-update guards only for source %s',
    async (source) => {
      const { table, viewId } = buildTable();
      const recordId = `rec${'s'.repeat(16)}`;
      const tableRecordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const handler = new ApplyRecordOrdersHandler(
        new TableQueryService(new FakeTableRepository([table])),
        tableRecordRepository,
        new FakeTableRecordQueryRepository(
          ok({
            records: [{ id: recordId, fields: {}, version: 1, orders: { [viewId.toString()]: 1 } }],
            total: 1,
          })
        ),
        new EventBusDomainWriteTransaction(unitOfWork, eventBus),
        createRecordWritePluginRunner([
          {
            name: 'deny-record-updates',
            supports: (kind) => kind === RecordWriteOperationKind.updateMany,
            guard: () =>
              err(domainError.forbidden({ code: 'test.update_denied', message: 'Denied' })),
          },
        ])
      );

      const result = await handler.handle(
        createContext(),
        createCommand(table.id().toString(), viewId.toString(), [{ recordId, order: 2 }], source)
      );

      if (source === 'recordUpdate') {
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().code).toBe('test.update_denied');
        expect(tableRecordRepository.updateBatches).toHaveLength(0);
        expect(unitOfWork.transactions).toHaveLength(0);
        expect(eventBus.publishedMany).toHaveLength(0);
      } else {
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap().updatedRecordIds).toEqual([recordId]);
        expect(tableRecordRepository.updateBatches[0]).toHaveLength(1);
        expect(eventBus.publishedMany).toHaveLength(1);
      }
    }
  );

  it.each([1, 2])(
    'atomically checks every record-update order against the current row scope (%s allowed)',
    async (allowedCount) => {
      const { table, viewId } = buildTable();
      const recordIds = [`rec${'t'.repeat(16)}`, `rec${'u'.repeat(16)}`];
      const command = createCommand(
        table.id().toString(),
        viewId.toString(),
        recordIds.map((recordId, index) => ({ recordId, order: index + 10 })),
        'recordUpdate'
      );
      const tableRecordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const handler = new ApplyRecordOrdersHandler(
        new TableQueryService(new FakeTableRepository([table])),
        tableRecordRepository,
        new FakeTableRecordQueryRepository(
          ok({
            records: recordIds.map((id, index) => ({
              id,
              fields: {},
              version: 1,
              orders: { [viewId.toString()]: index + 1 },
            })),
            total: recordIds.length,
          })
        ),
        new EventBusDomainWriteTransaction(unitOfWork, eventBus),
        createRecordWritePluginRunner([
          {
            name: 'current-update-row-scope',
            supports: (kind) => kind === RecordWriteOperationKind.updateMany,
            scope: () =>
              ok({
                recordSpec: RecordByIdsSpec.create(
                  command.records.slice(0, allowedCount).map((item) => item.recordId)
                ),
              }),
          },
        ])
      );

      const result = await handler.handle(createContext(), command);

      if (allowedCount < recordIds.length) {
        expect(result.isErr()).toBe(true);
        expect(result._unsafeUnwrapErr().code).toBe('record_write_plugin.scope_forbidden');
        expect(tableRecordRepository.updateBatches).toHaveLength(0);
        expect(unitOfWork.transactions).toHaveLength(0);
        expect(eventBus.publishedMany).toHaveLength(0);
      } else {
        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap().updatedRecordIds).toEqual(recordIds);
        expect(tableRecordRepository.updateBatches[0]).toHaveLength(recordIds.length);
        expect(unitOfWork.transactions).toHaveLength(1);
        expect(eventBus.publishedMany).toHaveLength(1);
      }
    }
  );
});
