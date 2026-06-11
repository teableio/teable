import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableQueryService } from '../application/services/TableQueryService';
import type { UndoRedoStackService } from '../application/services/UndoRedoStackService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldName } from '../domain/table/fields/FieldName';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IRecordOrderCalculator } from '../ports/RecordOrderCalculator';
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
import { ReorderRecordsCommand } from './ReorderRecordsCommand';
import { ReorderRecordsHandler } from './ReorderRecordsHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Reorder Records')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  const viewId = table.views()[0]!.id();
  return { table, viewId };
};

const createCommand = (tableId: string, viewId: string, recordIds: string[]) =>
  ReorderRecordsCommand.create({
    tableId,
    recordIds,
    order: {
      viewId,
      anchorId: `rec${'c'.repeat(14)}01`,
      position: 'after',
    },
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
  result: Result<ITableRecordQueryResult, DomainError>;

  constructor(result: Result<ITableRecordQueryResult, DomainError>) {
    this.result = result;
  }

  async find(): Promise<Result<ITableRecordQueryResult, DomainError>> {
    return this.result;
  }

  async findOne(): Promise<Result<TableRecordReadModel, DomainError>> {
    return err(domainError.notFound({ message: 'Not implemented' }));
  }

  async *findStream(): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    yield* [];
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

describe('ReorderRecordsHandler', () => {
  it('reorders records, publishes event, and records undo redo when orders change', async () => {
    const { table, viewId } = buildTable();
    const recordIds = [`rec${'d'.repeat(14)}01`, `rec${'e'.repeat(14)}02`];
    const command = createCommand(table.id().toString(), viewId.toString(), recordIds);
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const undoRedoEntries: unknown[] = [];

    const handler = new ReorderRecordsHandler(
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
      {
        calculateOrders: async () => ok([10, 11]),
      } as IRecordOrderCalculator,
      eventBus,
      {
        appendEntry: async (_context, _tableId, entry) => {
          undoRedoEntries.push(entry);
          return ok(undefined);
        },
      } as unknown as UndoRedoStackService,
      new FakeUnitOfWork()
    );

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedRecordIds).toEqual(recordIds);
    expect(tableRecordRepository.updateBatches).toHaveLength(1);
    expect(tableRecordRepository.updateBatches[0]).toHaveLength(2);
    expect(eventBus.publishedMany).toHaveLength(1);
    expect(undoRedoEntries).toHaveLength(1);
    expect(undoRedoEntries[0]).toMatchObject({
      undoCommand: {
        type: 'ApplyRecordOrders',
        payload: {
          tableId: table.id().toString(),
          viewId: viewId.toString(),
          records: [
            { recordId: recordIds[0], order: 1 },
            { recordId: recordIds[1], order: 2 },
          ],
        },
      },
      redoCommand: {
        type: 'ApplyRecordOrders',
        payload: {
          tableId: table.id().toString(),
          viewId: viewId.toString(),
          records: [
            { recordId: recordIds[0], order: 10 },
            { recordId: recordIds[1], order: 11 },
          ],
        },
      },
    });
  });

  it('skips undo redo recording when calculated orders are unchanged', async () => {
    const { table, viewId } = buildTable();
    const recordIds = [`rec${'f'.repeat(14)}01`];
    const command = createCommand(table.id().toString(), viewId.toString(), recordIds);
    const undoRedoEntries: unknown[] = [];

    const handler = new ReorderRecordsHandler(
      new TableQueryService(new FakeTableRepository([table])),
      new FakeTableRecordRepository(),
      new FakeTableRecordQueryRepository(
        ok({
          records: [
            { id: recordIds[0], orders: { [viewId.toString()]: 10 } },
          ] as unknown as TableRecordReadModel[],
          total: 1,
        })
      ),
      {
        calculateOrders: async () => ok([10]),
      } as IRecordOrderCalculator,
      new FakeEventBus(),
      {
        appendEntry: async (_context, _tableId, entry) => {
          undoRedoEntries.push(entry);
          return ok(undefined);
        },
      } as unknown as UndoRedoStackService,
      new FakeUnitOfWork()
    );

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(undoRedoEntries).toHaveLength(0);
  });

  it('returns view.not_found before calculating orders when target view is missing', async () => {
    const { table } = buildTable();
    const missingViewId = `viw${'g'.repeat(16)}`;
    const command = createCommand(table.id().toString(), missingViewId, [`rec${'h'.repeat(14)}01`]);

    const handler = new ReorderRecordsHandler(
      new TableQueryService(new FakeTableRepository([table])),
      new FakeTableRecordRepository(),
      new FakeTableRecordQueryRepository(ok({ records: [], total: 0 })),
      {
        calculateOrders: async () => ok([1]),
      } as IRecordOrderCalculator,
      new FakeEventBus(),
      {
        appendEntry: async () => ok(undefined),
      } as unknown as UndoRedoStackService,
      new FakeUnitOfWork()
    );

    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('view.not_found');
  });

  it('propagates previous order query failures without mutating records', async () => {
    const { table, viewId } = buildTable();
    const command = createCommand(table.id().toString(), viewId.toString(), [
      `rec${'i'.repeat(14)}01`,
    ]);
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new ReorderRecordsHandler(
      new TableQueryService(new FakeTableRepository([table])),
      tableRecordRepository,
      new FakeTableRecordQueryRepository(
        err(
          domainError.infrastructure({
            code: 'reorder.previous_orders_failed',
            message: 'query failed',
          })
        )
      ),
      {
        calculateOrders: async () => ok([5]),
      } as IRecordOrderCalculator,
      eventBus,
      {
        appendEntry: async () => ok(undefined),
      } as unknown as UndoRedoStackService,
      unitOfWork
    );

    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('reorder.previous_orders_failed');
    expect(tableRecordRepository.updateBatches).toHaveLength(0);
    expect(eventBus.publishedMany).toHaveLength(0);
    expect(unitOfWork.transactions).toHaveLength(0);
  });
});
