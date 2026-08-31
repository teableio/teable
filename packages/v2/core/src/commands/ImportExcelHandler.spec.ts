import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { createDefaultTableDataSafetyLimitComposer } from '../application/services/TableDataSafetyLimitComposer';
import { TableDataSafetyLimitTableOperationPlugin } from '../application/services/TableDataSafetyLimitTableOperationPlugin';
import { ActorId } from '../domain/shared/ActorId';
import { isDomainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { isRecordsBatchCreatedEvent } from '../domain/table/events/RecordsBatchCreated';
import type { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type {
  IExecutionContext,
  IUnitOfWorkTransaction,
  UnitOfWorkScope,
} from '../ports/ExecutionContext';
import type {
  IImportOptions,
  IImportParseResult,
  IImportSource,
} from '../ports/import/IImportSource';
import type { IImportSourceAdapter } from '../ports/import/IImportSourceAdapter';
import type { IImportSourceRegistry } from '../ports/import/IImportSourceRegistry';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  ITableRecordRepository,
  BatchRecordMutationResult,
  InsertManyStreamOptions,
  RecordMutationResult,
  UpdateManyStreamResult,
} from '../ports/TableRecordRepository';
import type {
  ITableRepository,
  TableProvisionOperationOptions,
  TableProvisionState,
} from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { excelParseResultToCsvParseResult, ImportExcelHandler } from './ImportExcelHandler';
import { ImportExcelCommand } from './ImportExcelCommand';
import { createTableOperationPluginRunner } from './tableOperationPluginRunnerTestUtils';

const baseId = `bse${'b'.repeat(16)}`;

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const createTableLimitPluginRunner = (tableRepository: ITableRepository) =>
  createTableOperationPluginRunner([
    new TableDataSafetyLimitTableOperationPlugin(
      tableRepository,
      createDefaultTableDataSafetyLimitComposer()
    ),
  ]);

const isAsyncIterable = <T>(value: Iterable<T> | AsyncIterable<T>): value is AsyncIterable<T> =>
  typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function';

class FakeImportAdapter implements IImportSourceAdapter {
  readonly supportedTypes = ['excel', 'xlsx'] as const;
  parseCalls: Array<{ source: IImportSource; options?: IImportOptions }> = [];

  constructor(private readonly result: Result<IImportParseResult, DomainError>) {}

  supports(type: string): boolean {
    return this.supportedTypes.includes(type as 'excel' | 'xlsx');
  }

  async parse(
    source: IImportSource,
    options?: IImportOptions
  ): Promise<Result<IImportParseResult, DomainError>> {
    this.parseCalls.push({ source, options });
    return this.result;
  }
}

class FakeImportSourceRegistry implements IImportSourceRegistry {
  constructor(private readonly adapter: IImportSourceAdapter) {}

  register(_: IImportSourceAdapter): void {
    return undefined;
  }

  getAdapter(_: string): Result<IImportSourceAdapter, DomainError> {
    return ok(this.adapter);
  }

  getSupportedTypes(): ReadonlyArray<string> {
    return this.adapter.supportedTypes;
  }

  supports(type: string): boolean {
    return this.adapter.supports(type);
  }
}

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  provisionStateChanges: Array<{
    tableId: string;
    state: TableProvisionState;
    status?: string;
    lastError?: string | null;
  }> = [];

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

  async duplicatePhysicalRows(
    _context: IExecutionContext,
    _plan: never
  ): Promise<Result<{ rowCount: number; recordIds: string[] }, DomainError>> {
    return ok({ rowCount: 0, recordIds: [] });
  }

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const match = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!match) {
      return err({
        code: 'not_found',
        message: 'Table not found',
        tags: ['not-found'],
        toString: () => 'Table not found',
      });
    }
    return ok(match);
  }

  async find(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    __?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async restore(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async setProvisionState(
    _: IExecutionContext,
    table: Table,
    state: TableProvisionState,
    operation?: TableProvisionOperationOptions
  ): Promise<Result<void, DomainError>> {
    this.provisionStateChanges.push({
      tableId: table.id().toString(),
      state,
      status: operation?.status,
      lastError: operation?.lastError,
    });
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  inserted: Table[] = [];

  async insert(_: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    this.inserted.push(table);
    return ok(undefined);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    this.inserted.push(...tables);
    return ok(undefined);
  }

  async update(
    _: IExecutionContext,
    table: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  inserted: TableRecord[] = [];

  async insert(
    _: IExecutionContext,
    __: Table,
    ___: TableRecord
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertMany(
    _: IExecutionContext,
    __: Table,
    ___: ReadonlyArray<TableRecord>
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertManyStream(
    _: IExecutionContext,
    __: Table,
    batches: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>,
    options?: InsertManyStreamOptions
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    let totalInserted = 0;
    let batchIndex = 0;
    try {
      if (isAsyncIterable(batches)) {
        for await (const batch of batches) {
          this.inserted.push(...batch);
          totalInserted += batch.length;
          options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
          batchIndex += 1;
        }
      } else {
        for (const batch of batches) {
          this.inserted.push(...batch);
          totalInserted += batch.length;
          options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
          batchIndex += 1;
        }
      }
    } catch (error) {
      if (isDomainError(error)) {
        return err(error);
      }
      throw error;
    }

    return ok({ totalInserted });
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId,
    ____: ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async updateMany(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    ____: ICellValueSpec
  ) {
    return ok({ totalUpdated: 0, updatedRecordIds: [], updatedRecords: [] });
  }

  async updateManyStream(
    _: IExecutionContext,
    __: Table,
    ___: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    return ok({ totalUpdated: 0, updatedRecords: [] });
  }

  async deleteMany(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ) {
    return ok({});
  }

  async deleteManyStream(): Promise<Result<{ totalDeleted: number }, DomainError>> {
    return ok({ totalDeleted: 0 });
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];

  async publish(_: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(_: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    this.published.push(...events);
    return ok(undefined);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    const scope: UnitOfWorkScope = options?.scope ?? 'data';
    const existing = context.transactions?.[scope];
    if (existing) {
      return work({ ...context, transaction: existing });
    }
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction', scope };
    return work({
      ...context,
      transaction,
      transactions: {
        ...(context.transactions ?? {}),
        [scope]: transaction,
      },
    });
  }
}

const createHandler = (
  adapter: FakeImportAdapter,
  tableRepository = new FakeTableRepository(),
  tableRecordRepository = new FakeTableRecordRepository()
) => {
  const tableSchemaRepository = new FakeTableSchemaRepository();
  const eventBus = new FakeEventBus();
  const unitOfWork = new FakeUnitOfWork();
  const handler = new ImportExcelHandler(
    new FakeImportSourceRegistry(adapter),
    tableRepository,
    tableSchemaRepository,
    tableRecordRepository,
    eventBus,
    unitOfWork,
    undefined,
    createTableLimitPluginRunner(tableRepository)
  );
  return { handler, tableRepository, tableRecordRepository, eventBus, adapter };
};

describe('excelParseResultToCsvParseResult', () => {
  it('uniquifies duplicate headers and skips the header row', () => {
    const result = excelParseResultToCsvParseResult(
      {
        headers: ['Name', 'Name'],
        rows: [
          ['Name', 'Name'],
          ['Alice', 'Bob'],
        ],
        rowCount: 2,
      },
      true
    );

    expect(result.isOk()).toBe(true);
    const parsed = result._unsafeUnwrap();
    expect(parsed.headers).toEqual(['Name', 'Name 2']);
    expect([...parsed.rows]).toEqual([{ Name: 'Alice', 'Name 2': 'Bob' }]);
    expect(parsed.rowCount).toBe(1);
  });

  it('treats the first row as data when useFirstRowAsHeader is false', () => {
    const result = excelParseResultToCsvParseResult(
      {
        headers: ['Alice', '30'],
        rows: [
          ['Alice', '30'],
          ['Bob', '40'],
        ],
      },
      false
    );

    expect(result.isOk()).toBe(true);
    const parsed = result._unsafeUnwrap();
    expect(parsed.headers).toEqual(['Field 1', 'Field 2']);
    expect([...parsed.rows]).toEqual([
      { 'Field 1': 'Alice', 'Field 2': '30' },
      { 'Field 1': 'Bob', 'Field 2': '40' },
    ]);
  });
});

describe('ImportExcelHandler', () => {
  it('imports excel data and creates table/records', async () => {
    const adapter = new FakeImportAdapter(
      ok({
        headers: ['Name', 'Age', 'Note'],
        rows: [
          ['Name', 'Age', 'Note'],
          ['Alice', '30', 'hello'],
          ['Bob', '40', ''],
        ],
      })
    );
    const { handler, tableRecordRepository, eventBus, tableRepository } = createHandler(adapter);

    const command = ImportExcelCommand.createFromBuffer({
      baseId,
      excelData: new Uint8Array([1, 2, 3]),
      tableName: 'People',
      sheetName: 'Sheet1',
      batchSize: 2,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);

    const value = result._unsafeUnwrap();
    expect(value.totalImported).toBe(2);
    expect(value.table.name().toString()).toBe('People');
    expect(value.table.getFields().map((field) => field.name().toString())).toEqual([
      'Name',
      'Age',
      'Note',
    ]);
    expect(adapter.parseCalls[0]?.options?.sheetName).toBe('Sheet1');
    expect(tableRecordRepository.inserted).toHaveLength(2);
    expect(eventBus.published.filter(isRecordsBatchCreatedEvent).length).toBeGreaterThan(0);
    expect(tableRepository.provisionStateChanges.map(({ state }) => state)).toEqual([
      'pending',
      'ready',
    ]);
  });

  it('reports insert progress with real row totals', async () => {
    const adapter = new FakeImportAdapter(
      ok({
        headers: ['Name'],
        rowCount: 5,
        rows: [['Name'], ['A'], ['B'], ['C'], ['D']],
      })
    );
    const { handler } = createHandler(adapter);
    const progress: Array<{ phase: string; processedRows: number; totalRows?: number }> = [];

    const command = ImportExcelCommand.createFromBuffer({
      baseId,
      excelData: new Uint8Array([1, 2, 3]),
      tableName: 'Progress',
      batchSize: 2,
    })
      ._unsafeUnwrap()
      .withOnProgress((event) => {
        progress.push({
          phase: event.phase,
          processedRows: event.processedRows,
          totalRows: event.totalRows,
        });
      });

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalImported).toBe(4);
    expect(progress.some((event) => event.phase === 'inserting' && event.totalRows === 4)).toBe(
      true
    );
    expect(progress.some((event) => event.phase === 'inserting' && event.processedRows === 4)).toBe(
      true
    );
    expect(progress.at(-1)).toMatchObject({
      phase: 'completed',
      processedRows: 4,
      totalRows: 4,
    });
  });

  it('uniquifies duplicate excel headers instead of colliding', async () => {
    const adapter = new FakeImportAdapter(
      ok({
        headers: ['Name', 'Name'],
        rows: [
          ['Name', 'Name'],
          ['Alice', 'Bob'],
        ],
      })
    );
    const { handler } = createHandler(adapter);

    const command = ImportExcelCommand.createFromBuffer({
      baseId,
      excelData: new Uint8Array([1, 2, 3]),
      tableName: 'Duplicates',
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.table.getFields().map((field) => field.name().toString())).toEqual([
      'Name',
      'Name 2',
    ]);
    expect(value.totalImported).toBe(1);
  });

  it('creates table schema only when importData is false', async () => {
    const adapter = new FakeImportAdapter(
      ok({
        headers: ['Name', 'Age'],
        rows: [
          ['Name', 'Age'],
          ['Alice', '30'],
        ],
      })
    );
    const { handler, tableRecordRepository } = createHandler(adapter);

    const command = ImportExcelCommand.createFromBuffer({
      baseId,
      excelData: new Uint8Array([1, 2, 3]),
      tableName: 'Schema Only',
      importData: false,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalImported).toBe(0);
    expect(tableRecordRepository.inserted).toHaveLength(0);
  });

  it('fails by default when excel rows exceed maxRowCount', async () => {
    const adapter = new FakeImportAdapter(
      ok({
        headers: ['Name'],
        rows: [['Name'], ['Alice'], ['Bob']],
        rowCount: 3,
      })
    );
    const { handler, tableRecordRepository } = createHandler(adapter);

    const command = ImportExcelCommand.createFromBuffer({
      baseId,
      excelData: new Uint8Array([1, 2, 3]),
      tableName: 'Over Limit',
      maxRowCount: 1,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.rows_per_table_max');
    expect(tableRecordRepository.inserted).toHaveLength(0);
  });

  it('imports up to maxRowCount when truncateOnRowLimit is set', async () => {
    const adapter = new FakeImportAdapter(
      ok({
        headers: ['Name'],
        rows: [['Name'], ['Alice'], ['Bob'], ['Cara']],
        rowCount: 4,
      })
    );
    const { handler, tableRecordRepository, tableRepository } = createHandler(adapter);

    const command = ImportExcelCommand.createFromBuffer({
      baseId,
      excelData: new Uint8Array([1, 2, 3]),
      tableName: 'Truncated',
      maxRowCount: 1,
    })
      ._unsafeUnwrap()
      .withTruncateOnRowLimit(true);

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalImported).toBe(1);
    expect(tableRecordRepository.inserted).toHaveLength(1);
    expect(tableRepository.provisionStateChanges.map(({ state }) => state)).toEqual([
      'pending',
      'ready',
    ]);
  });
});
