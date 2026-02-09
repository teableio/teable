import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoService } from '../application/services/UndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
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
import type { IRecordCreateConstraintService } from '../ports/RecordCreateConstraintService';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  ITableRecordQueryOptions,
  ITableRecordQueryRepository,
  ITableRecordQueryResult,
  ITableRecordQueryStreamOptions,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type { ITableRecordRepository } from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { DuplicateRecordCommand } from './DuplicateRecordCommand';
import { DuplicateRecordHandler } from './DuplicateRecordHandler';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  return { actorId: actorIdResult._unsafeUnwrap() };
};

const noopUndoRedoService = {
  recordEntry: async () => ok(undefined),
} as unknown as UndoRedoService;

const createTableUpdateFlow = (
  tableRepository: FakeTableRepository,
  eventBus: FakeEventBus,
  unitOfWork: FakeUnitOfWork
) => new TableUpdateFlow(tableRepository, new FakeTableSchemaRepository(), eventBus, unitOfWork);

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  updated: Table[] = [];
  lastContext: IExecutionContext | undefined;
  failFind: DomainError | undefined;

  async insert(_context: IExecutionContext, table: Table) {
    this.tables.push(table);
    return ok(table);
  }

  async insertMany(_context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.tables.push(...tables);
    return ok([...tables]);
  }

  async findOne(
    context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    this.lastContext = context;
    if (this.failFind) return err(this.failFind);
    const match = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!match) return err(domainError.notFound({ message: 'Table not found' }));
    return ok(match);
  }

  async find(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    if (this.failFind) return err(this.failFind);
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _context: IExecutionContext,
    _table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const index = this.tables.findIndex((entry) => entry.id().equals(_table.id()));
    if (index >= 0) {
      this.tables[index] = _table;
    }
    this.updated.push(_table);
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  async insert(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _context: IExecutionContext,
    _tables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async update(
    _context: IExecutionContext,
    _table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  records: TableRecord[] = [];
  lastContext: IExecutionContext | undefined;
  lastTable: Table | undefined;
  failInsert: DomainError | undefined;

  async insert(
    context: IExecutionContext,
    table: Table,
    record: TableRecord
  ): Promise<Result<{ computedChanges?: ReadonlyMap<string, unknown> }, DomainError>> {
    this.lastContext = context;
    this.lastTable = table;
    if (this.failInsert) return err(this.failInsert);
    this.records.push(record);
    return ok({});
  }

  async insertMany(
    context: IExecutionContext,
    table: Table,
    records: ReadonlyArray<TableRecord>
  ): Promise<
    Result<
      { computedChangesByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>> },
      DomainError
    >
  > {
    this.lastContext = context;
    this.lastTable = table;
    if (this.failInsert) return err(this.failInsert);
    this.records.push(...records);
    return ok({});
  }

  async insertManyStream(
    context: IExecutionContext,
    table: Table,
    batches: Iterable<ReadonlyArray<TableRecord>>,
    options?: {
      onBatchInserted?: (info: {
        batchIndex: number;
        insertedCount: number;
        totalInserted: number;
      }) => void;
    }
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    this.lastContext = context;
    this.lastTable = table;
    if (this.failInsert) return err(this.failInsert);
    let totalInserted = 0;
    let batchIndex = 0;
    for (const batch of batches) {
      this.records.push(...batch);
      totalInserted += batch.length;
      options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
      batchIndex++;
    }
    return ok({ totalInserted });
  }

  async updateOne(
    _context: IExecutionContext,
    _table: Table,
    _recordId: RecordId,
    _mutateSpec: ICellValueSpec
  ): Promise<Result<{ computedChanges?: ReadonlyMap<string, unknown> }, DomainError>> {
    return ok({});
  }

  async updateManyStream(
    _context: IExecutionContext,
    _table: Table,
    _batches: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<{ totalUpdated: number }, DomainError>> {
    return ok({ totalUpdated: 0 });
  }

  async deleteMany(
    _context: IExecutionContext,
    _table: Table,
    _spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  records: Map<string, TableRecordReadModel> = new Map();
  failFind: DomainError | undefined;

  async find(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _options?: ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    if (this.failFind) return err(this.failFind);
    const records = Array.from(this.records.values());
    return ok({ records, total: records.length });
  }

  async findOne(
    _context: IExecutionContext,
    _table: Table,
    recordId: RecordId,
    _options?: Pick<ITableRecordQueryOptions, 'mode'>
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    if (this.failFind) return err(this.failFind);
    const record = this.records.get(recordId.toString());
    if (!record) return err(domainError.notFound({ message: 'Record not found' }));
    return ok(record);
  }

  async *findStream(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    if (this.failFind) {
      yield err(this.failFind);
      return;
    }
    for (const record of this.records.values()) {
      yield ok(record);
    }
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

const createFakeRecordMutationSpecResolverService = () =>
  ({
    needsResolution: () => ok(false),
    resolveAndReplace: async (_context: IExecutionContext, spec: ICellValueSpec) => ok(spec),
  }) as unknown as RecordMutationSpecResolverService;

class FakeRecordCreateConstraintService implements IRecordCreateConstraintService {
  constructor(private readonly result: Result<void, DomainError> = ok(undefined)) {}

  register(): void {
    // No-op for tests.
  }

  async checkCreate(
    _context: IExecutionContext,
    _tableId: TableId,
    _recordCount: number
  ): Promise<Result<void, DomainError>> {
    return this.result;
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  transactions: IExecutionContext[] = [];
  rollbacks: IExecutionContext[] = [];

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    const transactionContext = { ...context, transaction };
    this.transactions.push(transactionContext);
    const result = await work(transactionContext);
    if (result.isErr()) {
      this.rollbacks.push(transactionContext);
    }
    return result;
  }
}

const createTestTable = (baseId: string, tableId: string) => {
  const baseIdResult = BaseId.create(baseId);
  const tableIdResult = TableId.create(tableId);
  const tableNameResult = TableName.create('Test Table');
  const textFieldId = FieldId.create(`fld${'t'.repeat(16)}`);
  const numberFieldId = FieldId.create(`fld${'n'.repeat(16)}`);
  const dateFieldId = FieldId.create(`fld${'d'.repeat(16)}`);

  const builder = Table.builder()
    .withId(tableIdResult._unsafeUnwrap())
    .withBaseId(baseIdResult._unsafeUnwrap())
    .withName(tableNameResult._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(textFieldId._unsafeUnwrap())
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(numberFieldId._unsafeUnwrap())
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder
    .field()
    .date()
    .withId(dateFieldId._unsafeUnwrap())
    .withName(FieldName.create('Date')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    textFieldId: textFieldId._unsafeUnwrap().toString(),
    numberFieldId: numberFieldId._unsafeUnwrap().toString(),
    dateFieldId: dateFieldId._unsafeUnwrap().toString(),
  };
};

describe('DuplicateRecordHandler', () => {
  const baseId = `bse${'a'.repeat(16)}`;
  const tableId = `tbl${'b'.repeat(16)}`;
  const sourceRecordId = `rec${'c'.repeat(16)}`;

  it('duplicates a record and persists it', async () => {
    const { table, textFieldId, numberFieldId } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    // Set up source record in query repository
    recordQueryRepository.records.set(sourceRecordId, {
      id: sourceRecordId,
      fields: {
        [textFieldId]: 'Original Value',
        [numberFieldId]: 100,
      },
      version: 1,
    });

    const handler = new DuplicateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      createFakeRecordMutationSpecResolverService(),
      new FakeRecordCreateConstraintService(),
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = DuplicateRecordCommand.create({
      tableId,
      recordId: sourceRecordId,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(recordRepository.records.length).toBe(1);
    const savedRecord = recordRepository.records[0];
    expect(savedRecord.tableId().equals(table.id())).toBe(true);
    // The duplicated record should have a different ID
    expect(savedRecord.id().toString()).not.toBe(sourceRecordId);
    expect(unitOfWork.transactions.length).toBe(1);
  });

  it('copies field values from source record', async () => {
    const { table, textFieldId, numberFieldId } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    // Set up source record with specific values
    recordQueryRepository.records.set(sourceRecordId, {
      id: sourceRecordId,
      fields: {
        [textFieldId]: 'Test Title',
        [numberFieldId]: 42,
      },
      version: 1,
    });

    const handler = new DuplicateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      createFakeRecordMutationSpecResolverService(),
      new FakeRecordCreateConstraintService(),
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = DuplicateRecordCommand.create({
      tableId,
      recordId: sourceRecordId,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const { record } = result._unsafeUnwrap();

    // Check that field values were copied
    const textValue = record.fields().get(FieldId.create(textFieldId)._unsafeUnwrap())?.toValue();
    const numberValue = record
      .fields()
      .get(FieldId.create(numberFieldId)._unsafeUnwrap())
      ?.toValue();

    expect(textValue).toBe('Test Title');
    expect(numberValue).toBe(42);
  });

  it('duplicates record when source date field value is a Date instance', async () => {
    const { table, textFieldId, dateFieldId } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const sourceDate = new Date('2026-02-05T16:17:50.000Z');
    recordQueryRepository.records.set(sourceRecordId, {
      id: sourceRecordId,
      fields: {
        [textFieldId]: 'Date Row',
        [dateFieldId]: sourceDate,
      },
      version: 1,
    });

    const handler = new DuplicateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      createFakeRecordMutationSpecResolverService(),
      new FakeRecordCreateConstraintService(),
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = DuplicateRecordCommand.create({
      tableId,
      recordId: sourceRecordId,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const { record } = result._unsafeUnwrap();

    const dateValue = record.fields().get(FieldId.create(dateFieldId)._unsafeUnwrap())?.toValue();
    expect(dateValue).toBe(sourceDate.toISOString());
  });

  it('returns error when table not found', async () => {
    const tableRepository = new FakeTableRepository();
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new DuplicateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      createFakeRecordMutationSpecResolverService(),
      new FakeRecordCreateConstraintService(),
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = DuplicateRecordCommand.create({
      tableId: `tbl${'x'.repeat(16)}`,
      recordId: sourceRecordId,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not found');
  });

  it('returns error when source record not found', async () => {
    const { table } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    // Don't add any records to the query repository

    const handler = new DuplicateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      createFakeRecordMutationSpecResolverService(),
      new FakeRecordCreateConstraintService(),
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = DuplicateRecordCommand.create({
      tableId,
      recordId: sourceRecordId,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not found');
  });

  it('returns error when record insert fails', async () => {
    const { table, textFieldId } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    recordRepository.failInsert = domainError.infrastructure({
      message: 'Insert failed',
      code: 'infrastructure.database',
    });
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    recordQueryRepository.records.set(sourceRecordId, {
      id: sourceRecordId,
      fields: {
        [textFieldId]: 'Test',
      },
      version: 1,
    });

    const handler = new DuplicateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      createFakeRecordMutationSpecResolverService(),
      new FakeRecordCreateConstraintService(),
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = DuplicateRecordCommand.create({
      tableId,
      recordId: sourceRecordId,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('Insert failed');
  });

  it('returns the duplicated record in result', async () => {
    const { table, textFieldId } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    recordQueryRepository.records.set(sourceRecordId, {
      id: sourceRecordId,
      fields: {
        [textFieldId]: 'My Title',
      },
      version: 1,
    });

    const handler = new DuplicateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      createFakeRecordMutationSpecResolverService(),
      new FakeRecordCreateConstraintService(),
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = DuplicateRecordCommand.create({
      tableId,
      recordId: sourceRecordId,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const { record } = result._unsafeUnwrap();

    expect(record.id().toString()).toMatch(/^rec/);
    expect(record.tableId().equals(table.id())).toBe(true);
  });

  it('does not copy null/undefined field values', async () => {
    const { table, textFieldId, numberFieldId } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    // Source record with null value for number field
    recordQueryRepository.records.set(sourceRecordId, {
      id: sourceRecordId,
      fields: {
        [textFieldId]: 'Test',
        [numberFieldId]: null,
      },
      version: 1,
    });

    const handler = new DuplicateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      createFakeRecordMutationSpecResolverService(),
      new FakeRecordCreateConstraintService(),
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = DuplicateRecordCommand.create({
      tableId,
      recordId: sourceRecordId,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const { record } = result._unsafeUnwrap();

    // Text field should be copied
    const textValue = record.fields().get(FieldId.create(textFieldId)._unsafeUnwrap())?.toValue();
    expect(textValue).toBe('Test');

    // Number field should not be set (null was skipped)
    const numberFieldIdObj = FieldId.create(numberFieldId)._unsafeUnwrap();
    const numberValue = record.fields().get(numberFieldIdObj);
    expect(numberValue).toBeUndefined();
  });
});
