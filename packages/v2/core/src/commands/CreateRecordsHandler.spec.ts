import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableQueryService } from '../application/services/TableQueryService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRecordRepository } from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { CreateRecordsCommand } from './CreateRecordsCommand';
import { CreateRecordsHandler } from './CreateRecordsHandler';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  return { actorId: actorIdResult._unsafeUnwrap() };
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  lastContext: IExecutionContext | undefined;
  failFind: DomainError | undefined;

  async insert(_context: IExecutionContext, table: Table) {
    this.tables.push(table);
    return ok(table);
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
  ): Promise<Result<void, DomainError>> {
    this.lastContext = context;
    this.lastTable = table;
    if (this.failInsert) return err(this.failInsert);
    this.records.push(record);
    return ok(undefined);
  }

  async insertMany(
    context: IExecutionContext,
    table: Table,
    records: ReadonlyArray<TableRecord>
  ): Promise<Result<void, DomainError>> {
    this.lastContext = context;
    this.lastTable = table;
    if (this.failInsertMany) return err(this.failInsertMany);
    this.records.push(...records);
    return ok(undefined);
  }

  async update(
    _context: IExecutionContext,
    _table: Table,
    _record: TableRecord
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(
    _context: IExecutionContext,
    _table: Table,
    _recordId: unknown
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

const createTestTable = (baseId: string, tableId: string) => {
  const baseIdResult = BaseId.create(baseId);
  const tableIdResult = TableId.create(tableId);
  const tableNameResult = TableName.create('Test Table');
  const textFieldId = FieldId.create(`fld${'t'.repeat(16)}`);
  const numberFieldId = FieldId.create(`fld${'n'.repeat(16)}`);

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
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    textFieldId: textFieldId._unsafeUnwrap().toString(),
    numberFieldId: numberFieldId._unsafeUnwrap().toString(),
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

    const handler = new CreateRecordsHandler(
      tableQueryService,
      recordRepository,
      eventBus,
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

    const handler = new CreateRecordsHandler(
      tableQueryService,
      recordRepository,
      eventBus,
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

    const handler = new CreateRecordsHandler(
      tableQueryService,
      recordRepository,
      eventBus,
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

    const handler = new CreateRecordsHandler(
      tableQueryService,
      recordRepository,
      eventBus,
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

    const handler = new CreateRecordsHandler(
      tableQueryService,
      recordRepository,
      eventBus,
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

    const handler = new CreateRecordsHandler(
      tableQueryService,
      recordRepository,
      eventBus,
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

    const handler = new CreateRecordsHandler(
      tableQueryService,
      recordRepository,
      eventBus,
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

    const handler = new CreateRecordsHandler(
      tableQueryService,
      recordRepository,
      eventBus,
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

    const handler = new CreateRecordsHandler(
      tableQueryService,
      recordRepository,
      eventBus,
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

      const handler = new CreateRecordsHandler(
        tableQueryService,
        recordRepository,
        eventBus,
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

      const handler = new CreateRecordsHandler(
        tableQueryService,
        recordRepository,
        eventBus,
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
});
