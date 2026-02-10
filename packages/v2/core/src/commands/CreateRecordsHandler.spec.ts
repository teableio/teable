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
import type { MultipleSelectField } from '../domain/table/fields/types/MultipleSelectField';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import type { SingleSelectField } from '../domain/table/fields/types/SingleSelectField';
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
  BatchRecordMutationResult,
  ITableRecordRepository,
  RecordMutationResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { CreateRecordsCommand } from './CreateRecordsCommand';
import { CreateRecordsHandler } from './CreateRecordsHandler';

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

const createHandler = (
  tableQueryService: TableQueryService,
  recordRepository: ITableRecordRepository,
  recordMutationSpecResolver: RecordMutationSpecResolverService,
  recordCreateConstraintService: IRecordCreateConstraintService,
  tableUpdateFlow: TableUpdateFlow,
  eventBus: IEventBus,
  undoRedoService: UndoRedoService,
  unitOfWork: IUnitOfWork
) =>
  new CreateRecordsHandler(
    tableQueryService,
    recordRepository,
    recordMutationSpecResolver,
    recordCreateConstraintService,
    new RecordWriteSideEffectService(),
    tableUpdateFlow,
    eventBus,
    undoRedoService,
    unitOfWork
  );

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
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const index = this.tables.findIndex((entry) => entry.id().equals(table.id()));
    if (index >= 0) {
      this.tables[index] = table;
    }
    this.updated.push(table);
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
  failInsertMany: DomainError | undefined;

  async insert(
    context: IExecutionContext,
    table: Table,
    record: TableRecord
  ): Promise<Result<RecordMutationResult, DomainError>> {
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
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    this.lastContext = context;
    this.lastTable = table;
    if (this.failInsertMany) return err(this.failInsertMany);
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
    if (this.failInsertMany) return err(this.failInsertMany);
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
  ): Promise<Result<RecordMutationResult, DomainError>> {
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

/**
 * A FakeUnitOfWork that simulates real rollback behavior:
 * - On error, rolls back by restoring the record repository state.
 */
class RollbackFakeUnitOfWork implements IUnitOfWork {
  transactions: IExecutionContext[] = [];
  rollbacks: IExecutionContext[] = [];
  private recordRepository: FakeTableRecordRepository;

  constructor(recordRepository: FakeTableRecordRepository) {
    this.recordRepository = recordRepository;
  }

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    const transactionContext = { ...context, transaction };
    this.transactions.push(transactionContext);

    // Snapshot before transaction
    const snapshotRecords = [...this.recordRepository.records];

    const result = await work(transactionContext);
    if (result.isErr()) {
      // Rollback: restore the snapshot
      this.rollbacks.push(transactionContext);
      this.recordRepository.records = snapshotRecords;
    }
    return result;
  }
}

/**
 * A FakeRecordMutationSpecResolverService that tracks calls and can be configured.
 */
class FakeRecordMutationSpecResolverService {
  needsResolutionValue = false;
  resolveCalls: ICellValueSpec[] = [];

  needsResolution(_spec: ICellValueSpec): Result<boolean, DomainError> {
    return ok(this.needsResolutionValue);
  }

  async resolveAndReplace(
    _context: IExecutionContext,
    spec: ICellValueSpec
  ): Promise<Result<ICellValueSpec, DomainError>> {
    this.resolveCalls.push(spec);
    return ok(spec);
  }
}

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

const createTestTable = (baseId: string, tableId: string) => {
  const baseIdResult = BaseId.create(baseId);
  const tableIdResult = TableId.create(tableId);
  const tableNameResult = TableName.create('Test Table');
  const textFieldId = FieldId.create(`fld${'t'.repeat(16)}`);
  const numberFieldId = FieldId.create(`fld${'n'.repeat(16)}`);
  const singleSelectFieldId = FieldId.create(`fld${'s'.repeat(16)}`);
  const multiSelectFieldId = FieldId.create(`fld${'m'.repeat(16)}`);
  const openOption = SelectOption.create({ name: 'Open', color: 'blue' })._unsafeUnwrap();
  const tagOption = SelectOption.create({ name: 'Tag A', color: 'green' })._unsafeUnwrap();

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
    .singleSelect()
    .withId(singleSelectFieldId._unsafeUnwrap())
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([openOption])
    .done();
  builder
    .field()
    .multipleSelect()
    .withId(multiSelectFieldId._unsafeUnwrap())
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withOptions([tagOption])
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    textFieldId: textFieldId._unsafeUnwrap().toString(),
    numberFieldId: numberFieldId._unsafeUnwrap().toString(),
    singleSelectFieldId: singleSelectFieldId._unsafeUnwrap().toString(),
    multiSelectFieldId: multiSelectFieldId._unsafeUnwrap().toString(),
  };
};

describe('CreateRecordsHandler', () => {
  const baseId = `bse${'a'.repeat(16)}`;
  const tableId = `tbl${'b'.repeat(16)}`;

  it('creates multiple records and persists them', async () => {
    const { table, textFieldId, numberFieldId } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new FakeRecordCreateConstraintService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [
        {
          fields: {
            [textFieldId]: 'First Record',
            [numberFieldId]: 100,
          },
        },
        {
          fields: {
            [textFieldId]: 'Second Record',
            [numberFieldId]: 200,
          },
        },
        {
          fields: {
            [textFieldId]: 'Third Record',
            [numberFieldId]: 300,
          },
        },
      ],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(recordRepository.records.length).toBe(3);
    expect(unitOfWork.transactions.length).toBe(1);
    expect(recordRepository.lastContext?.transaction?.kind).toBe('unitOfWorkTransaction');

    // Verify all records belong to the table
    for (const record of recordRepository.records) {
      expect(record.tableId().equals(table.id())).toBe(true);
    }
  });

  it('creates a single record via records array', async () => {
    const { table, textFieldId } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new FakeRecordCreateConstraintService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [
        {
          fields: {
            [textFieldId]: 'Single Record',
          },
        },
      ],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(recordRepository.records.length).toBe(1);
  });

  it('creates records with empty fields', async () => {
    const { table } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new FakeRecordCreateConstraintService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [{ fields: {} }, { fields: {} }],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(recordRepository.records.length).toBe(2);
  });

  it('returns error when table not found', async () => {
    const tableRepository = new FakeTableRepository();
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new FakeRecordCreateConstraintService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = CreateRecordsCommand.create({
      tableId: `tbl${'x'.repeat(16)}`,
      records: [{ fields: {} }],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not found');
  });

  it('returns error when repository find fails', async () => {
    const tableRepository = new FakeTableRepository();
    tableRepository.failFind = domainError.unexpected({ message: 'Find failed' });
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new FakeRecordCreateConstraintService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [{ fields: {} }],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('Find failed');
  });

  it('returns error when insertMany fails', async () => {
    const { table } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    recordRepository.failInsertMany = domainError.infrastructure({
      message: 'InsertMany failed',
      code: 'infrastructure.database',
    });
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new FakeRecordCreateConstraintService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [{ fields: {} }, { fields: {} }],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('InsertMany failed');
  });

  it('returns error when field validation fails for any record', async () => {
    const { table, numberFieldId } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new FakeRecordCreateConstraintService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    // Second record has invalid number value
    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [
        { fields: { [numberFieldId]: 100 } },
        { fields: { [numberFieldId]: 'not a number' } }, // Invalid
        { fields: { [numberFieldId]: 300 } },
      ],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Invalid value');
  });

  it('returns all created records in result', async () => {
    const { table, textFieldId } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new FakeRecordCreateConstraintService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [
        { fields: { [textFieldId]: 'Record A' } },
        { fields: { [textFieldId]: 'Record B' } },
      ],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const { records } = result._unsafeUnwrap();

    expect(records.length).toBe(2);
    for (const record of records) {
      expect(record.id().toString()).toMatch(/^rec/);
      expect(record.tableId().equals(table.id())).toBe(true);
    }
  });

  it('generates unique IDs for each record', async () => {
    const { table } = createTestTable(baseId, tableId);

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new FakeRecordCreateConstraintService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const commandResult = CreateRecordsCommand.create({
      tableId,
      records: [{ fields: {} }, { fields: {} }, { fields: {} }, { fields: {} }, { fields: {} }],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const { records } = result._unsafeUnwrap();

    const ids = new Set(records.map((r) => r.id().toString()));
    expect(ids.size).toBe(5); // All IDs should be unique
  });

  describe('transaction rollback', () => {
    it('rolls back when insertMany fails', async () => {
      const { table, textFieldId } = createTestTable(baseId, tableId);

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new RollbackFakeUnitOfWork(recordRepository);

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new FakeRecordCreateConstraintService(),
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      // First, insert records successfully
      const firstCommand = CreateRecordsCommand.create({
        tableId,
        records: [{ fields: { [textFieldId]: 'First Batch Record' } }],
      });
      const firstResult = await handler.handle(createContext(), firstCommand._unsafeUnwrap());
      firstResult._unsafeUnwrap();
      expect(recordRepository.records.length).toBe(1);

      // Now simulate insertMany failure on second batch
      recordRepository.failInsertMany = domainError.infrastructure({
        message: 'Batch insert failed: FK constraint violation',
        code: 'infrastructure.database.batch_insert_failed',
      });

      const secondCommand = CreateRecordsCommand.create({
        tableId,
        records: [
          { fields: { [textFieldId]: 'Second Batch Record 1' } },
          { fields: { [textFieldId]: 'Second Batch Record 2' } },
        ],
      });
      const secondResult = await handler.handle(createContext(), secondCommand._unsafeUnwrap());

      // Should return error
      expect(secondResult.isErr()).toBe(true);
      expect(secondResult._unsafeUnwrapErr().message).toContain('Batch insert failed');

      // Transaction should have been rolled back
      expect(unitOfWork.rollbacks.length).toBe(1);

      // Record count should still be 1 (the first successful batch)
      expect(recordRepository.records.length).toBe(1);
    });

    it('does not roll back when transaction succeeds', async () => {
      const { table, textFieldId } = createTestTable(baseId, tableId);

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new RollbackFakeUnitOfWork(recordRepository);

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new FakeRecordCreateConstraintService(),
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const command = CreateRecordsCommand.create({
        tableId,
        records: [
          { fields: { [textFieldId]: 'Success Record 1' } },
          { fields: { [textFieldId]: 'Success Record 2' } },
        ],
      });
      const result = await handler.handle(createContext(), command._unsafeUnwrap());
      result._unsafeUnwrap();

      // Transaction succeeded - no rollbacks
      expect(unitOfWork.rollbacks.length).toBe(0);
      expect(unitOfWork.transactions.length).toBe(1);
      expect(recordRepository.records.length).toBe(2);
    });
  });

  describe('field key mapping', () => {
    it('returns fieldKeyMapping using fieldId when input uses fieldId', async () => {
      const { table, textFieldId, numberFieldId } = createTestTable(baseId, tableId);

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new FakeRecordCreateConstraintService(),
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = CreateRecordsCommand.create({
        tableId,
        records: [
          {
            fields: {
              [textFieldId]: 'Test Record',
              [numberFieldId]: 100,
            },
          },
        ],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      const { fieldKeyMapping } = result._unsafeUnwrap();

      // fieldKeyMapping should map fieldId -> original input key (which is fieldId)
      expect(fieldKeyMapping.get(textFieldId)).toBe(textFieldId);
      expect(fieldKeyMapping.get(numberFieldId)).toBe(numberFieldId);
    });

    it('returns fieldKeyMapping using fieldName when input uses fieldName', async () => {
      const { table, textFieldId, numberFieldId } = createTestTable(baseId, tableId);

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new FakeRecordCreateConstraintService(),
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      // Use fieldName as key instead of fieldId
      const commandResult = CreateRecordsCommand.create({
        tableId,
        records: [
          {
            fields: {
              Title: 'Test Record',
              Amount: 100,
            },
          },
        ],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      const { fieldKeyMapping } = result._unsafeUnwrap();

      // fieldKeyMapping should map fieldId -> original input key (which is fieldName)
      expect(fieldKeyMapping.get(textFieldId)).toBe('Title');
      expect(fieldKeyMapping.get(numberFieldId)).toBe('Amount');
    });

    it('returns fieldKeyMapping with mixed keys', async () => {
      const { table, textFieldId, numberFieldId } = createTestTable(baseId, tableId);

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new FakeRecordCreateConstraintService(),
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      // Mix fieldId and fieldName
      const commandResult = CreateRecordsCommand.create({
        tableId,
        records: [
          {
            fields: {
              Title: 'Test Record', // Use fieldName
              [numberFieldId]: 100, // Use fieldId
            },
          },
        ],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      const { fieldKeyMapping } = result._unsafeUnwrap();

      // fieldKeyMapping should preserve original input keys
      expect(fieldKeyMapping.get(textFieldId)).toBe('Title');
      expect(fieldKeyMapping.get(numberFieldId)).toBe(numberFieldId);
    });

    it('returns error when field key is not found', async () => {
      const { table, textFieldId } = createTestTable(baseId, tableId);

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new FakeRecordCreateConstraintService(),
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = CreateRecordsCommand.create({
        tableId,
        records: [
          {
            fields: {
              [textFieldId]: 'Valid',
              UnknownField: 'Should fail',
            },
          },
        ],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('field.not_found');
    });
  });

  describe('typecast', () => {
    it('invokes resolver when resolution is needed (typecast true)', async () => {
      const { table, textFieldId } = createTestTable(baseId, tableId);

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const resolver = new FakeRecordMutationSpecResolverService();
      resolver.needsResolutionValue = true;

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        resolver as unknown as RecordMutationSpecResolverService,
        new FakeRecordCreateConstraintService(),
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = CreateRecordsCommand.create({
        tableId,
        records: [
          {
            fields: {
              [textFieldId]: 'Test Record',
            },
          },
        ],
        typecast: true,
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      result._unsafeUnwrap();

      expect(resolver.resolveCalls.length).toBe(1);
    });

    it('auto creates select options when typecast is enabled', async () => {
      const { table, textFieldId, singleSelectFieldId, multiSelectFieldId } = createTestTable(
        baseId,
        tableId
      );

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new FakeRecordCreateConstraintService(),
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = CreateRecordsCommand.create({
        tableId,
        typecast: true,
        records: [
          {
            fields: {
              [textFieldId]: 'Option Seed',
              [singleSelectFieldId]: 'In Progress',
              [multiSelectFieldId]: ['Tag A', 'Tag B'],
            },
          },
        ],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      result._unsafeUnwrap();

      expect(tableRepository.updated.length).toBe(1);
      const updatedTable = tableRepository.updated[0];
      if (!updatedTable) {
        throw new Error('Expected updated table');
      }

      const singleField = updatedTable
        .getField((field) => field.id().toString() === singleSelectFieldId)
        ._unsafeUnwrap() as SingleSelectField;
      const singleNames = singleField.selectOptions().map((option) => option.name().toString());
      expect(singleNames).toContain('In Progress');

      const multiField = updatedTable
        .getField((field) => field.id().toString() === multiSelectFieldId)
        ._unsafeUnwrap() as MultipleSelectField;
      const multiNames = multiField.selectOptions().map((option) => option.name().toString());
      expect(multiNames).toContain('Tag B');
    });

    it('invokes resolver when resolution is needed (typecast false)', async () => {
      const { table, textFieldId } = createTestTable(baseId, tableId);

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const resolver = new FakeRecordMutationSpecResolverService();
      resolver.needsResolutionValue = true;

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        resolver as unknown as RecordMutationSpecResolverService,
        new FakeRecordCreateConstraintService(),
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = CreateRecordsCommand.create({
        tableId,
        records: [
          {
            fields: {
              [textFieldId]: 'Test Record',
            },
          },
        ],
        typecast: false,
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      result._unsafeUnwrap();

      expect(resolver.resolveCalls.length).toBe(1);
    });

    it('does not invoke link title resolver when needsResolution is false', async () => {
      const { table, textFieldId } = createTestTable(baseId, tableId);

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const resolver = new FakeRecordMutationSpecResolverService();
      resolver.needsResolutionValue = false;

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        resolver as unknown as RecordMutationSpecResolverService,
        new FakeRecordCreateConstraintService(),
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = CreateRecordsCommand.create({
        tableId,
        records: [
          {
            fields: {
              [textFieldId]: 'Test Record',
            },
          },
        ],
        typecast: true,
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      result._unsafeUnwrap();

      expect(resolver.resolveCalls.length).toBe(0);
    });

    it('resolves each record spec separately when multiple records need resolution', async () => {
      const { table, textFieldId } = createTestTable(baseId, tableId);

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const resolver = new FakeRecordMutationSpecResolverService();
      resolver.needsResolutionValue = true;

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        resolver as unknown as RecordMutationSpecResolverService,
        new FakeRecordCreateConstraintService(),
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = CreateRecordsCommand.create({
        tableId,
        records: [
          { fields: { [textFieldId]: 'Record 1' } },
          { fields: { [textFieldId]: 'Record 2' } },
          { fields: { [textFieldId]: 'Record 3' } },
        ],
        typecast: true,
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      result._unsafeUnwrap();

      // Each record's spec is resolved separately
      expect(resolver.resolveCalls.length).toBe(3);
    });
  });
});
