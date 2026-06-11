import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { DeleteByRangeApplicationService } from '../application/services/DeleteByRangeApplicationService';
import { TableQueryService } from '../application/services/TableQueryService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { RecordsDeleted } from '../domain/table/events/RecordsDeleted';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  ITableRecordQueryRepository,
  ITableRecordQueryOptions,
  ITableRecordQueryResult,
  ITableRecordQueryStreamOptions,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type {
  ITableRecordRepository,
  RecordMutationResult,
  BatchRecordMutationResult,
  RecordStoredSnapshot,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { DeleteByRangeCommand } from './DeleteByRangeCommand';
import { DeleteByRangeHandler } from './DeleteByRangeHandler';
import {
  createRecordWritePluginRunner,
  createTrackedRecordWritePlugin,
  expectRecordWritePluginToBeSkipped,
} from './recordWritePluginRunnerTestUtils';
import { createNoopUndoRedoStackService } from './undoRedoStackServiceTestUtils';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId, requestId: 'req-delete-direct-test' };
};

const noopUndoRedoService = createNoopUndoRedoStackService();

const buildTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Records Table')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
  const numberFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(numberFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  const viewId = table.views()[0].id().toString();

  return { table, baseId, tableId, textFieldId, numberFieldId, viewId };
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];

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
    if (!match) return err(domainError.notFound({ message: 'Table not found' }));
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

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  lastContext: IExecutionContext | undefined;
  lastTable: Table | undefined;
  lastSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined;
  failDelete: DomainError | undefined;
  deletedRecordsOverride: ReadonlyArray<RecordStoredSnapshot> | null = null;

  constructor(private readonly queryRepository?: FakeTableRecordQueryRepository) {}

  async insert(
    _: IExecutionContext,
    __: Table,
    ___: TableRecord
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({ computedChanges: undefined });
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
    ___: Iterable<ReadonlyArray<TableRecord>>
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    return ok({ totalInserted: 0 });
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId,
    ____: ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({ computedChanges: undefined });
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
  ): Promise<Result<{ totalUpdated: number; updatedRecords: [] }, DomainError>> {
    return ok({ totalUpdated: 0, updatedRecords: [] });
  }

  async deleteMany(
    context: IExecutionContext,
    table: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<{ deletedRecords?: ReadonlyArray<RecordStoredSnapshot> }, DomainError>> {
    this.lastContext = context;
    this.lastTable = table;
    this.lastSpec = spec;
    if (this.failDelete) return err(this.failDelete);
    const recordIdSet =
      spec instanceof RecordByIdsSpec
        ? new Set(spec.recordIds().map((recordId) => recordId.toString()))
        : undefined;
    const deletedRecords =
      this.deletedRecordsOverride ??
      (recordIdSet && this.queryRepository
        ? this.queryRepository.records
            .filter((record) => recordIdSet.has(record.id))
            .map((record) => toStoredSnapshot(record))
        : []);
    if (this.queryRepository && spec instanceof RecordByIdsSpec) {
      const deletedRecordIdSet =
        this.deletedRecordsOverride == null
          ? recordIdSet
          : new Set(deletedRecords.map((record) => record.recordId));
      this.queryRepository.records = this.queryRepository.records.filter(
        (record) => !deletedRecordIdSet?.has(record.id)
      );
      this.queryRepository.total = this.queryRepository.records.length;
    }
    return ok(deletedRecords.length > 0 ? { deletedRecords } : {});
  }

  async deleteManyStream(): Promise<Result<{ totalDeleted: number }, DomainError>> {
    return ok({ totalDeleted: 0 });
  }
}

const toStoredSnapshot = (record: TableRecordReadModel): RecordStoredSnapshot => ({
  recordId: record.id,
  fields: record.fields,
  ...(record.orders ? { orders: record.orders } : {}),
  ...(record.autoNumber !== undefined ? { autoNumber: record.autoNumber } : {}),
  ...(record.createdTime ? { createdTime: record.createdTime } : {}),
  ...(record.createdBy ? { createdBy: record.createdBy } : {}),
  ...(record.lastModifiedTime ? { lastModifiedTime: record.lastModifiedTime } : {}),
  ...(record.lastModifiedBy ? { lastModifiedBy: record.lastModifiedBy } : {}),
});

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

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  records: TableRecordReadModel[] = [];
  total = 0;

  async find(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    // Simulate pagination - OffsetPagination has methods that return value objects
    const offset = options?.pagination?.offset()?.toNumber() ?? 0;
    const limit = options?.pagination?.limit()?.toNumber() ?? this.records.length;
    const paginatedRecords = this.records.slice(offset, offset + limit);
    return ok({ records: paginatedRecords, total: this.total || this.records.length });
  }

  async findOne(
    _context: IExecutionContext,
    _table: Table,
    _recordId: RecordId,
    _options?: Pick<ITableRecordQueryOptions, 'mode'>
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    const record = this.records[0];
    if (!record) return err(domainError.notFound({ message: 'Record not found' }));
    return ok(record);
  }

  async *findStream(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    for (const record of this.records) {
      yield ok(record);
    }
  }
}

const createHandler = (args: {
  tableRepository: FakeTableRepository;
  recordRepository?: FakeTableRecordRepository;
  queryRepository: FakeTableRecordQueryRepository;
  eventBus?: FakeEventBus;
  plugins?: ReturnType<typeof createTrackedRecordWritePlugin>['plugin'][];
  unitOfWork?: FakeUnitOfWork;
}) => {
  const deleteByRangeApplicationService = new DeleteByRangeApplicationService(
    new TableQueryService(args.tableRepository),
    createRecordWritePluginRunner(args.plugins),
    args.recordRepository ?? new FakeTableRecordRepository(args.queryRepository),
    args.queryRepository,
    args.eventBus ?? new FakeEventBus(),
    noopUndoRedoService,
    args.unitOfWork ?? new FakeUnitOfWork()
  );

  return new DeleteByRangeHandler(deleteByRangeApplicationService);
};

describe('DeleteByRangeHandler', () => {
  it('deletes records in range and publishes event with record snapshots', async () => {
    const { table, tableId, viewId, textFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { [textFieldId.toString()]: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { [textFieldId.toString()]: 'Record B' }, version: 1 },
      { id: `rec${'c'.repeat(16)}`, fields: { [textFieldId.toString()]: 'Record C' }, version: 1 },
    ];
    queryRepository.total = 3;

    const eventBus = new FakeEventBus();

    const handler = createHandler({
      tableRepository,
      queryRepository,
      eventBus,
    });

    // Delete rows 0-1 (first two records)
    const commandResult = DeleteByRangeCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [
        [0, 0],
        [1, 1],
      ],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.deletedCount).toBe(2);
    expect(payload.deletedRecordIds).toHaveLength(2);
    expect(payload.events.some((event) => event instanceof RecordsDeleted)).toBe(true);

    // Verify record snapshots are included in the event
    const deletedEvent = payload.events.find(
      (event): event is RecordsDeleted => event instanceof RecordsDeleted
    );
    expect(deletedEvent?.recordSnapshots).toHaveLength(2);
    expect(deletedEvent?.recordSnapshots[0].id).toBe(`rec${'a'.repeat(16)}`);
    expect(deletedEvent?.recordSnapshots[0].fields).toEqual({
      [textFieldId.toString()]: 'Record A',
    });
    expect(deletedEvent?.recordSnapshots[0].displayName).toBe('Record A');
  });

  it('skips plugins that do not support deleteMany', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
    ];
    queryRepository.total = 2;
    const eventBus = new FakeEventBus();
    const { plugin, calls } = createTrackedRecordWritePlugin([RecordWriteOperationKind.createOne]);

    const handler = createHandler({
      tableRepository,
      queryRepository,
      eventBus,
      plugins: [plugin],
    });

    const command = DeleteByRangeCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [
        [0, 0],
        [1, 1],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    result._unsafeUnwrap();

    expectRecordWritePluginToBeSkipped(calls, RecordWriteOperationKind.deleteMany);
  });

  it('passes operation-scope orchestration metadata to delete plugins', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
    ];
    queryRepository.total = 2;
    const { plugin, calls } = createTrackedRecordWritePlugin([RecordWriteOperationKind.deleteMany]);

    const handler = createHandler({
      tableRepository,
      queryRepository,
      plugins: [plugin],
    });

    const command = DeleteByRangeCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 1]],
      type: 'rows',
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    result._unsafeUnwrap();

    expect(calls.prepare).toHaveLength(1);
    expect(calls.guard).toHaveLength(1);
    expect(calls.beforePersist).toHaveLength(1);
    expect(calls.afterCommit).toHaveLength(1);
    expect(calls.prepare[0].payload.recordCount).toBe(2);
    expect(calls.prepare[0].orchestration).toEqual({
      mode: 'direct',
      scope: 'operation',
      operationId: 'req-delete-direct-test',
      totalRecordCount: 2,
      totalChunkCount: 1,
    });
  });

  it('returns empty result when no records in range', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [];
    queryRepository.total = 0;

    const handler = createHandler({
      tableRepository,
      queryRepository,
    });

    const commandResult = DeleteByRangeCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [
        [0, 0],
        [1, 1],
      ],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.deletedCount).toBe(0);
    expect(payload.deletedRecordIds).toHaveLength(0);
    expect(payload.events).toHaveLength(0);
  });

  it('handles rows type range correctly', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
      { id: `rec${'c'.repeat(16)}`, fields: { title: 'Record C' }, version: 1 },
    ];
    queryRepository.total = 10; // Simulate more total rows

    const eventBus = new FakeEventBus();

    const handler = createHandler({
      tableRepository,
      queryRepository,
      eventBus,
    });

    // Delete rows 0-2 (type: rows)
    const commandResult = DeleteByRangeCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 2]], // rows 0-2
      type: 'rows',
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.deletedCount).toBe(3);
    expect(payload.events).toHaveLength(1);
  });

  it('uses RecordByIdsSpec for large rows deletion to avoid deep OR spec trees', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const recordCount = 12000;
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = Array.from({ length: recordCount }, (_, idx) => ({
      id: `rec${idx.toString(36).padStart(16, '0').slice(-16)}`,
      fields: { title: `Record ${idx}` },
      version: 1,
    }));
    queryRepository.total = recordCount;

    const recordRepository = new FakeTableRecordRepository(queryRepository);
    const handler = createHandler({
      tableRepository,
      recordRepository,
      queryRepository,
    });

    const commandResult = DeleteByRangeCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, recordCount - 1]],
      type: 'rows',
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.deletedCount).toBe(recordCount);
    expect(recordRepository.lastSpec).toBeInstanceOf(RecordByIdsSpec);
  });

  it('returns error when delete reports not found after planning rows', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
    ];

    const recordRepository = new FakeTableRecordRepository(queryRepository);
    recordRepository.failDelete = domainError.notFound({ message: 'Record missing' });
    const eventBus = new FakeEventBus();

    const handler = createHandler({
      tableRepository,
      recordRepository,
      queryRepository,
      eventBus,
    });

    const commandResult = DeleteByRangeCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record.stored_snapshot.unavailable');
    expect(eventBus.published).toHaveLength(0);
  });

  it('returns error when delete fails', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
    ];

    const recordRepository = new FakeTableRecordRepository(queryRepository);
    recordRepository.failDelete = domainError.unexpected({ message: 'delete failed' });

    const handler = createHandler({
      tableRepository,
      recordRepository,
      queryRepository,
    });

    const commandResult = DeleteByRangeCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('delete failed');
  });

  it('returns error when repository delete snapshots disagree with planned rows', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
    ];

    const recordRepository = new FakeTableRecordRepository(queryRepository);
    recordRepository.deletedRecordsOverride = [toStoredSnapshot(queryRepository.records[0]!)];

    const handler = createHandler({
      tableRepository,
      recordRepository,
      queryRepository,
    });

    const commandResult = DeleteByRangeCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 1]],
      type: 'rows',
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record.stored_snapshot.missing');
  });
});
