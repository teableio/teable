import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ImportTabularTableService } from '../application/services/ImportTabularTableService';
import { createDefaultTableDataSafetyLimitComposer } from '../application/services/TableDataSafetyLimitComposer';
import { TableDataSafetyLimitTableOperationPlugin } from '../application/services/TableDataSafetyLimitTableOperationPlugin';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, isDomainError, type DomainError } from '../domain/shared/DomainError';
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
import type { ICsvParser, CsvParseResult, CsvSource } from '../ports/CsvParser';
import type { IEventBus } from '../ports/EventBus';
import type {
  IExecutionContext,
  IUnitOfWorkTransaction,
  UnitOfWorkScope,
} from '../ports/ExecutionContext';
import { EventBusDomainWriteTransaction } from '../ports/memory/EventBusDomainWriteTransaction';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  ITableRecordRepository,
  BatchRecordMutationResult,
  InsertManyStreamOptions,
  PhysicalTableDuplicatePlan,
  PhysicalTableDuplicateResult,
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
import { ImportCsvCommand } from './ImportCsvCommand';
import { ImportCsvHandler } from './ImportCsvHandler';
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

class FakeCsvParser implements ICsvParser {
  constructor(
    private readonly syncResult: Result<CsvParseResult, DomainError>,
    private readonly asyncResult?: Result<CsvParseResult, DomainError>
  ) {}

  parse(_source: CsvSource): Result<CsvParseResult, DomainError> {
    return this.syncResult;
  }

  async parseAsync(_source: CsvSource): Promise<Result<CsvParseResult, DomainError>> {
    return this.asyncResult ?? this.syncResult;
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

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const match = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!match)
      return err({
        code: 'not_found',
        message: 'Table not found',
        tags: ['not-found'],
        toString: () => 'Table not found',
      });
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

  async delete(_: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    this.tables = this.tables.filter((existing) => !existing.id().equals(table.id()));
    return ok(undefined);
  }

  async restore(_: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    const index = this.tables.findIndex((existing) => existing.id().equals(table.id()));
    if (index < 0) this.tables.push(table);
    else this.tables[index] = table;
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

  async duplicatePhysicalRows(
    _context: IExecutionContext,
    _plan: PhysicalTableDuplicatePlan
  ): Promise<Result<PhysicalTableDuplicateResult, DomainError>> {
    throw new Error('Unexpected physical row duplication during import');
  }
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
  constructor(
    private readonly records?: FakeTableRecordRepository,
    private readonly schema?: FakeTableSchemaRepository
  ) {}

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
    const recordCount = this.records?.inserted.length ?? 0;
    const schemaCount = this.schema?.inserted.length ?? 0;
    const result = await work({
      ...context,
      transaction,
      transactions: {
        ...(context.transactions ?? {}),
        [scope]: transaction,
      },
    });
    if (result.isErr() && scope === 'data') {
      if (this.records) this.records.inserted.length = recordCount;
      if (this.schema) this.schema.inserted.length = schemaCount;
    }
    return result;
  }
}

const createStreamingImportHarness = (sourceRowCount: number, knownRowCount?: number) => {
  const source = { pulled: 0, closed: false };
  const parseResult: CsvParseResult = {
    headers: ['Name'],
    rows: [],
    rowCount: knownRowCount,
    rowsAsync: (async function* () {
      try {
        for (let index = 0; index < sourceRowCount; index++) {
          source.pulled += 1;
          yield { Name: `Row ${index}` };
        }
      } finally {
        source.closed = true;
      }
    })(),
  };
  const tables = new FakeTableRepository();
  const schema = new FakeTableSchemaRepository();
  const records = new FakeTableRecordRepository();
  const eventBus = new FakeEventBus();
  const unitOfWork = new FakeUnitOfWork(records, schema);
  const domainWriteTransaction = new EventBusDomainWriteTransaction(unitOfWork, eventBus);
  const tablePluginRunner = createTableLimitPluginRunner(tables);
  const handler = new ImportCsvHandler(
    new FakeCsvParser(ok(parseResult)),
    tables,
    schema,
    records,
    domainWriteTransaction,
    unitOfWork,
    undefined,
    tablePluginRunner
  );
  const importer = new ImportTabularTableService(
    tables,
    schema,
    records,
    domainWriteTransaction,
    unitOfWork,
    undefined,
    tablePluginRunner
  );
  const context: IExecutionContext = {
    ...createContext(),
    config: {
      tableLimits: { tableSchema: { maxCreateTableRecords: 750, maxTablesPerBase: 1 } },
    },
  };
  return { handler, importer, parseResult, context, tables, schema, records, eventBus, source };
};

describe('ImportCsvHandler', () => {
  it('allows an unknown-length import exactly at the composed table creation limit', async () => {
    const harness = createStreamingImportHarness(750);
    const result = await harness.handler.handle(
      harness.context,
      ImportCsvCommand.createFromString({
        baseId,
        csvData: 'Name\n',
        batchSize: 250,
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().totalImported).toBe(750);
    expect(harness.records.inserted).toHaveLength(750);
    expect(harness.tables.tables).toHaveLength(1);
    expect(harness.schema.inserted).toHaveLength(1);
    expect(
      harness.eventBus.published
        .filter(isRecordsBatchCreatedEvent)
        .flatMap((event) => event.records)
    ).toHaveLength(750);
    expect(harness.source).toEqual({ pulled: 750, closed: true });
  });

  it('rolls back every batch when the first row over the cumulative creation limit arrives', async () => {
    const harness = createStreamingImportHarness(751);
    const insertedProgress: number[] = [];
    const result = await harness.handler.handle(
      harness.context,
      ImportCsvCommand.createFromString({
        baseId,
        csvData: 'Name\n',
        batchSize: 250,
      })
        ._unsafeUnwrap()
        .withOnProgress((progress) => {
          if (progress.phase === 'inserting') insertedProgress.push(progress.processedRows);
        })
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.limit.create_table_records_max',
      details: { max: 750, attempted: 751, target: 'table.records' },
    });
    expect(insertedProgress.at(-1)).toBe(750);
    expect(harness.records.inserted).toEqual([]);
    expect(harness.schema.inserted).toEqual([]);
    expect(harness.tables.tables).toEqual([]);
    expect(harness.eventBus.published).toEqual([]);
    expect(harness.tables.provisionStateChanges.at(-1)).toMatchObject({ status: 'dead' });
    expect(harness.source).toEqual({ pulled: 751, closed: true });
  });

  it('rejects a known oversized import before creating metadata or storage', async () => {
    const harness = createStreamingImportHarness(751, 751);
    const result = await harness.handler.handle(
      harness.context,
      ImportCsvCommand.createFromString({ baseId, csvData: 'Name\n' })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.create_table_records_max');
    expect(harness.tables.provisionStateChanges).toEqual([]);
    expect(harness.tables.tables).toEqual([]);
    expect(harness.schema.inserted).toEqual([]);
    expect(harness.records.inserted).toEqual([]);
    expect(harness.eventBus.published).toEqual([]);
    expect(harness.source).toEqual({ pulled: 500, closed: true });
  });

  it.each([undefined, 20001])(
    'does not count source rows against schema-only creation with total %s',
    async (knownRowCount) => {
      const harness = createStreamingImportHarness(20001, knownRowCount);
      const result = await harness.handler.handle(
        harness.context,
        ImportCsvCommand.createFromString({
          baseId,
          csvData: 'Name\n',
          importData: false,
          maxRowCount: 1,
        })._unsafeUnwrap()
      );

      expect(result._unsafeUnwrap().totalImported).toBe(0);
      expect(harness.tables.tables).toHaveLength(1);
      expect(harness.schema.inserted).toHaveLength(1);
      expect(harness.records.inserted).toEqual([]);
      expect(harness.eventBus.published.filter(isRecordsBatchCreatedEvent)).toEqual([]);
      expect(harness.source).toEqual({ pulled: 500, closed: true });
    }
  );

  it('preserves row-count cap errors and rolls back earlier streamed batches', async () => {
    const harness = createStreamingImportHarness(751);
    const result = await harness.handler.handle(
      harness.context,
      ImportCsvCommand.createFromString({
        baseId,
        csvData: 'Name\n',
        batchSize: 250,
        maxRowCount: 750,
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.rows_per_table_max');
    expect(harness.records.inserted).toEqual([]);
    expect(harness.tables.tables).toEqual([]);
    expect(harness.schema.inserted).toEqual([]);
    expect(harness.eventBus.published).toEqual([]);
    expect(harness.source.closed).toBe(true);
  });

  it.each([undefined, 751])(
    'applies creation limits to inserted rows after truncation with source total %s',
    async (knownRowCount) => {
      const harness = createStreamingImportHarness(751, knownRowCount);
      const result = await harness.importer.import(harness.context, {
        baseId: BaseId.create(baseId)._unsafeUnwrap(),
        tableName: undefined,
        importData: true,
        batchSize: 250,
        maxRowCount: 750,
        columns: undefined,
        parseResult: harness.parseResult,
        source: 'excel',
        truncateOnRowLimit: true,
      });

      expect(result._unsafeUnwrap().totalImported).toBe(750);
      expect(harness.records.inserted).toHaveLength(750);
      expect(harness.tables.tables).toHaveLength(1);
      expect(harness.schema.inserted).toHaveLength(1);
      expect(harness.source).toEqual({ pulled: 751, closed: true });
    }
  );

  it('imports csv data and creates table/records', async () => {
    const parser = new FakeCsvParser(
      ok({
        headers: ['Name', 'Age', 'Note'],
        rows: [
          { Name: 'Alice', Age: '30', Note: 'hello' },
          { Name: 'Bob', Age: '40', Note: '' },
        ],
      })
    );
    const tableRepository = new FakeTableRepository();
    const tableSchemaRepository = new FakeTableSchemaRepository();
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new ImportCsvHandler(
      parser,
      tableRepository,
      tableSchemaRepository,
      tableRecordRepository,
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      unitOfWork,
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );

    const command = ImportCsvCommand.createFromString({
      baseId,
      csvData: 'Name,Age,Note\nAlice,30,hello\nBob,40,',
      tableName: 'People',
      batchSize: 100,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);

    const value = result._unsafeUnwrap();
    expect(value.totalImported).toBe(2);
    expect(value.table.name().toString()).toBe('People');
    expect(value.table.getFields()).toHaveLength(3);
    expect(value.table.getFields().map((field) => field.type().toString())).toEqual([
      'singleLineText',
      'number',
      'singleLineText',
    ]);
    expect(value.table.primaryField()._unsafeUnwrap().name().toString()).toBe('Name');
    expect(tableRecordRepository.inserted).toHaveLength(2);
    const noteFieldId = value.table.getFields()[2].id().toString();
    const insertedFieldValues = tableRecordRepository.inserted.map(
      (record) =>
        new Map(
          record
            .fields()
            .entries()
            .map((entry) => [entry.fieldId.toString(), entry.value])
        )
    );
    expect(insertedFieldValues[0].get(noteFieldId)?.toValue()).toBe('hello');
    expect(insertedFieldValues[1].has(noteFieldId)).toBe(false);
    const batchCreatedEvents = eventBus.published.filter(isRecordsBatchCreatedEvent);
    expect(eventBus.published.map((event) => event.name.toString())).toEqual([
      'TableCreated',
      'RecordsBatchCreated',
    ]);
    expect(batchCreatedEvents.map((event) => event.records.length)).toEqual([2]);
    expect(batchCreatedEvents.map((event) => event.source)).toEqual([{ type: 'import' }]);
    const [nameField, ageField, noteField] = value.table.getFields();
    expect(
      batchCreatedEvents
        .flatMap((event) => event.records)
        .map((record) => ({
          recordId: record.recordId,
          fields: Object.fromEntries(record.fields.map((field) => [field.fieldId, field.value])),
        }))
    ).toEqual([
      {
        recordId: tableRecordRepository.inserted[0].id().toString(),
        fields: {
          [nameField.id().toString()]: 'Alice',
          [ageField.id().toString()]: 30,
          [noteField.id().toString()]: 'hello',
        },
      },
      {
        recordId: tableRecordRepository.inserted[1].id().toString(),
        fields: {
          [nameField.id().toString()]: 'Bob',
          [ageField.id().toString()]: 40,
        },
      },
    ]);
    expect(value.table.pullDomainEvents()).toEqual([]);
    expect(tableRepository.provisionStateChanges.map(({ state }) => state)).toEqual([
      'pending',
      'ready',
    ]);
  });

  it('keeps committed table metadata and records when marking ready fails', async () => {
    const tableRepository = new FakeTableRepository();
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const failure = domainError.infrastructure({
      code: 'table.ready_failed',
      message: 'metadata connection failed',
    });
    const setProvisionState = tableRepository.setProvisionState.bind(tableRepository);
    tableRepository.setProvisionState = async (context, table, state, operation) => {
      if (state === 'ready') return err(failure);
      return setProvisionState(context, table, state, operation);
    };
    tableRepository.delete = async (_context, table) => {
      tableRepository.tables = tableRepository.tables.filter(
        (existing) => !existing.id().equals(table.id())
      );
      return ok(undefined);
    };
    const unitOfWork = new FakeUnitOfWork();
    const handler = new ImportCsvHandler(
      new FakeCsvParser(ok({ headers: ['Name'], rows: [{ Name: 'Persisted row' }] })),
      tableRepository,
      new FakeTableSchemaRepository(),
      tableRecordRepository,
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      unitOfWork,
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );
    const result = await handler.handle(
      createContext(),
      ImportCsvCommand.createFromString({
        baseId,
        csvData: 'Name\nPersisted row',
      })._unsafeUnwrap()
    );
    expect(tableRepository.tables).toHaveLength(1);
    const table = tableRepository.tables[0];
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: failure.code,
      details: { committed: true, tableId: table.id().toString() },
    });
    expect(
      tableRecordRepository.inserted.map((record) =>
        record.fields().get(table.primaryField()._unsafeUnwrap().id())?.toValue()
      )
    ).toEqual(['Persisted row']);
    expect(eventBus.published).toEqual([]);
  });

  it('creates table schema only when importData is false', async () => {
    const parser = new FakeCsvParser(
      ok({
        headers: ['Name', 'Age'],
        rows: [
          { Name: 'Alice', Age: '30' },
          { Name: 'Bob', Age: '40' },
        ],
      })
    );
    const tableRepository = new FakeTableRepository();
    const tableSchemaRepository = new FakeTableSchemaRepository();
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new ImportCsvHandler(
      parser,
      tableRepository,
      tableSchemaRepository,
      tableRecordRepository,
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      unitOfWork,
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );

    const command = ImportCsvCommand.createFromString({
      baseId,
      csvData: 'Name,Age\nAlice,30\nBob,40',
      tableName: 'People Schema Only',
      importData: false,
      maxRowCount: 1,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);

    const value = result._unsafeUnwrap();
    expect(value.totalImported).toBe(0);
    expect(value.table.name().toString()).toBe('People Schema Only');
    expect(value.table.getFields().map((field) => field.type().toString())).toEqual([
      'singleLineText',
      'number',
    ]);
    expect(tableSchemaRepository.inserted).toHaveLength(1);
    expect(tableRecordRepository.inserted).toHaveLength(0);
    expect(eventBus.published.some(isRecordsBatchCreatedEvent)).toBe(false);
    expect(tableRepository.provisionStateChanges.map(({ state }) => state)).toEqual([
      'pending',
      'ready',
    ]);
  });

  it('uses provided columns for field names and source column mapping', async () => {
    const parser = new FakeCsvParser(
      ok({
        headers: ['registration_date', 'total_registered_users', 'active_d1_users'],
        rows: [
          {
            registration_date: '2024-01-01',
            total_registered_users: '100',
            active_d1_users: '75',
          },
        ],
      })
    );
    const tableRepository = new FakeTableRepository();
    const tableRecordRepository = new FakeTableRecordRepository();
    const handler = new ImportCsvHandler(
      parser,
      tableRepository,
      new FakeTableSchemaRepository(),
      tableRecordRepository,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus()),
      new FakeUnitOfWork(),
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );

    const command = ImportCsvCommand.createFromString({
      baseId,
      csvData: 'registration_date,total_registered_users,active_d1_users\n2024-01-01,100,75',
      tableName: 'Custom Mapping',
      columns: [
        { name: '总注册用户', sourceColumnIndex: 1, type: 'number' },
        { name: '次日活跃用户', sourceColumnIndex: 2, type: 'number' },
        { name: '注册日期', sourceColumnIndex: 0, type: 'date' },
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);

    const table = result._unsafeUnwrap().table;
    expect(table.getFields().map((field) => field.name().toString())).toEqual([
      '总注册用户',
      '次日活跃用户',
      '注册日期',
    ]);
    expect(table.getFields().map((field) => field.type().toString())).toEqual([
      'number',
      'number',
      'date',
    ]);

    const insertedRecord = tableRecordRepository.inserted[0];
    const fieldsByName = new Map(
      table.getFields().map((field) => [field.name().toString(), field.id().toString()])
    );
    const valuesByFieldId = new Map(
      insertedRecord
        .fields()
        .entries()
        .map((entry) => [entry.fieldId.toString(), entry.value.toValue()])
    );

    expect(valuesByFieldId.get(fieldsByName.get('总注册用户')!)).toBe(100);
    expect(valuesByFieldId.get(fieldsByName.get('次日活跃用户')!)).toBe(75);
    expect(valuesByFieldId.get(fieldsByName.get('注册日期')!)).toBeDefined();
  });

  it('abandons the schema operation as dead when data-phase import fails and meta cleanup succeeds', async () => {
    const parser = new FakeCsvParser(
      ok({
        headers: ['Name', 'Age'],
        rows: [
          { Name: 'Alice', Age: '30' },
          { Name: 'Bob', Age: '40' },
        ],
      })
    );
    const tableRepository = new FakeTableRepository();
    const handler = new ImportCsvHandler(
      parser,
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeTableRecordRepository(),
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus()),
      new FakeUnitOfWork(),
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );

    const command = ImportCsvCommand.createFromString({
      baseId,
      csvData: 'Name,Age\nAlice,30\nBob,40',
      tableName: 'People Over Limit',
      maxRowCount: 1,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.rows_per_table_max');
    expect(tableRepository.provisionStateChanges.map(({ state }) => state)).toEqual([
      'pending',
      'error',
    ]);
    expect(tableRepository.provisionStateChanges.at(-1)).toMatchObject({
      lastError: 'Exceed max row limit: 1',
      state: 'error',
      status: 'dead',
    });
  });

  it('returns error when csv has no headers', async () => {
    const parser = new FakeCsvParser(
      ok({
        headers: [],
        rows: [],
      })
    );

    const tableRepository = new FakeTableRepository();
    const handler = new ImportCsvHandler(
      parser,
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeTableRecordRepository(),
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus()),
      new FakeUnitOfWork(),
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );

    const command = ImportCsvCommand.createFromString({
      baseId,
      csvData: '',
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('csv.no_columns');
  });

  it('fails when async parsing is required but not supported', async () => {
    const parser: ICsvParser = {
      parse: () =>
        ok({
          headers: ['Name'],
          rows: [{ Name: 'Only' }],
        }),
    };

    const tableRepository = new FakeTableRepository();
    const handler = new ImportCsvHandler(
      parser,
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeTableRecordRepository(),
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus()),
      new FakeUnitOfWork(),
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );

    const csvStream = (async function* () {
      yield 'Name\nOnly';
    })();

    const command = ImportCsvCommand.createFromStream({
      baseId,
      csvStream,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('csv.async_not_supported');
  });

  it('imports using async parser for stream source', async () => {
    const rowsAsync = (async function* () {
      yield { Name: 'Streamed' };
    })();

    const parser = new FakeCsvParser(
      ok({ headers: ['Name'], rows: [] }),
      ok({ headers: ['Name'], rows: [], rowsAsync })
    );

    const tableRepository = new FakeTableRepository();
    const handler = new ImportCsvHandler(
      parser,
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeTableRecordRepository(),
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus()),
      new FakeUnitOfWork(),
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );

    const csvStream = (async function* () {
      yield 'Name\nStreamed';
    })();

    const command = ImportCsvCommand.createFromStream({
      baseId,
      csvStream,
      batchSize: 1,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalImported).toBe(1);
  });

  it('keeps async CSV rows lazy until insertManyStream pulls them', async () => {
    const totalRows = 502;
    let pulled = 0;
    const pulledWhenInserted: number[] = [];
    const rowsAsync = (async function* () {
      for (let index = 0; index < totalRows; index++) {
        pulled += 1;
        yield { Name: `Row ${index}` };
      }
    })();

    const parser = new FakeCsvParser(
      ok({ headers: ['Name'], rows: [] }),
      ok({ headers: ['Name'], rows: [], rowsAsync })
    );
    const tableRepository = new FakeTableRepository();
    const tableRecordRepository = new FakeTableRecordRepository();
    const originalInsertManyStream =
      tableRecordRepository.insertManyStream.bind(tableRecordRepository);
    tableRecordRepository.insertManyStream = async (context, table, batches, options) => {
      if (!isAsyncIterable(batches)) {
        return originalInsertManyStream(context, table, batches, options);
      }
      async function* tap() {
        for await (const batch of batches) {
          pulledWhenInserted.push(pulled);
          yield batch;
        }
      }
      return originalInsertManyStream(context, table, tap(), options);
    };

    const eventBus = new FakeEventBus();
    const handler = new ImportCsvHandler(
      parser,
      tableRepository,
      new FakeTableSchemaRepository(),
      tableRecordRepository,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), eventBus),
      new FakeUnitOfWork(),
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );

    const result = await handler.handle(
      createContext(),
      ImportCsvCommand.createFromStream({
        baseId,
        csvStream: (async function* () {
          yield 'Name\n';
        })(),
        batchSize: 500,
      })._unsafeUnwrap()
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalImported).toBe(totalRows);
    expect(pulledWhenInserted[0]).toBe(500);
    expect(pulledWhenInserted[0]).toBeLessThan(totalRows);
    expect(pulled).toBe(totalRows);
    const batchEvents = eventBus.published.filter(isRecordsBatchCreatedEvent);
    expect(eventBus.published.map((event) => event.name.toString())).toEqual([
      'TableCreated',
      'RecordsBatchCreated',
      'RecordsBatchCreated',
    ]);
    expect(batchEvents.map((event) => event.records.length)).toEqual([500, 2]);
    const publishedRecords = batchEvents.flatMap((event) => event.records);
    expect(publishedRecords.map((record) => record.recordId)).toEqual(
      tableRecordRepository.inserted.map((record) => record.id().toString())
    );
    const nameFieldId = result._unsafeUnwrap().table.primaryField()._unsafeUnwrap().id().toString();
    expect(publishedRecords.map((record) => record.fields)).toEqual(
      Array.from({ length: totalRows }, (_, index) => [
        { fieldId: nameFieldId, value: `Row ${index}` },
      ])
    );
    expect(result._unsafeUnwrap().table.pullDomainEvents()).toEqual([]);
  });
  it.each(['schema-only', 'row-limit', 'schema-failure'] as const)(
    'closes the sampled input after %s before all rows are consumed',
    async (mode) => {
      let closed = false;
      let consumed = 0;
      const rowsAsync = (async function* () {
        try {
          for (let index = 0; index < 1000; index++) {
            consumed++;
            yield { Name: `Row ${index}` };
          }
        } finally {
          closed = true;
        }
      })();
      const parser = new FakeCsvParser(
        ok({ headers: ['Name'], rows: [] }),
        ok({ headers: ['Name'], rows: [], rowsAsync })
      );
      const tables = new FakeTableRepository();
      const schema = new FakeTableSchemaRepository();
      if (mode === 'schema-failure') {
        schema.insert = async () => err(domainError.infrastructure({ message: 'schema failed' }));
      }
      const handler = new ImportCsvHandler(
        parser,
        tables,
        schema,
        new FakeTableRecordRepository(),
        new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus()),
        new FakeUnitOfWork(),
        undefined,
        createTableLimitPluginRunner(tables)
      );
      const result = await handler.handle(
        createContext(),
        ImportCsvCommand.createFromStream({
          baseId,
          csvStream: (async function* () {
            yield 'Name\n';
          })(),
          importData: mode !== 'schema-only',
          ...(mode === 'row-limit' ? { maxRowCount: 1 } : {}),
        })._unsafeUnwrap()
      );
      expect(result.isOk()).toBe(mode === 'schema-only');
      expect(consumed).toBe(500);
      expect(closed).toBe(true);
    }
  );
});
