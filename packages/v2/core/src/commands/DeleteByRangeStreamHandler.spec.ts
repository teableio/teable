import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { DeleteByRangeApplicationService } from '../application/services/DeleteByRangeApplicationService';
import { TableQueryService } from '../application/services/TableQueryService';
import type { UndoRedoStackService } from '../application/services/UndoRedoStackService';
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
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  ITableRecordQueryRepository,
  ITableRecordQueryOptions,
  ITableRecordQueryResult,
  ITableRecordQueryStreamOptions,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type {
  BatchRecordMutationResult,
  ITableRecordRepository,
  RecordMutationResult,
  RecordStoredSnapshot,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ISpan, ITracer, SpanAttributes } from '../ports/Tracer';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { DeleteByRangeStreamCommand } from './DeleteByRangeStreamCommand';
import { DeleteByRangeStreamHandler } from './DeleteByRangeStreamHandler';
import {
  createRecordWritePluginRunner,
  createTrackedRecordWritePlugin,
} from './recordWritePluginRunnerTestUtils';

class FakeSpan implements ISpan {
  end = () => undefined;
  recordError = (_message: string) => undefined;
  setAttribute = (_key: string, _value: string | number | boolean) => undefined;
  setAttributes = (_attributes: SpanAttributes) => undefined;
}

class FakeTracer implements ITracer {
  readonly spans: Array<{ name: string; attributes?: SpanAttributes }> = [];

  startSpan(name: string, attributes?: SpanAttributes): ISpan {
    this.spans.push({ name, attributes });
    return new FakeSpan();
  }

  async withSpan<T>(_span: ISpan, callback: () => Promise<T>): Promise<T> {
    return callback();
  }

  getActiveSpan(): ISpan | undefined {
    return undefined;
  }
}

const createContext = (tracer?: ITracer): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId, requestId: 'req-delete-stream-test', tracer };
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Records Table')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();

  return { table, tableId, viewId: table.views()[0].id().toString() };
};

const buildRecordReadModel = (index: number): TableRecordReadModel => ({
  id: `rec${index.toString(36).padStart(16, '0').slice(-16)}`,
  fields: { title: `Record ${index}` },
  version: 1,
});

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  findOneCallCount = 0;

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
    this.findOneCallCount += 1;
    const table = this.tables.find((item) => spec.isSatisfiedBy(item));
    return table ? ok(table) : err(domainError.notFound({ message: 'Table not found' }));
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
  failDeleteByBatchIndex = new Map<number, DomainError>();
  deleteContexts: Array<IExecutionContext> = [];
  deleteRecordIdsByBatch: string[][] = [];

  constructor(private readonly queryRepository?: FakeTableRecordQueryRepository) {}

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

  async insertManyStream(): Promise<Result<{ totalInserted: number }, DomainError>> {
    return ok({ totalInserted: 0 });
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId,
    ____: ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async updateMany() {
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
    __: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<{ deletedRecords?: ReadonlyArray<RecordStoredSnapshot> }, DomainError>> {
    this.deleteContexts.push(context);

    const matchingIds =
      spec instanceof RecordByIdsSpec
        ? spec.recordIds().map((recordId) => recordId.toString())
        : [];
    this.deleteRecordIdsByBatch.push(matchingIds);

    const batchIndex = this.deleteRecordIdsByBatch.length - 1;
    const failure = this.failDeleteByBatchIndex.get(batchIndex);
    if (failure) {
      return err(failure);
    }

    if (this.queryRepository) {
      const deletedRecords = this.queryRepository.records
        .filter((record) => matchingIds.includes(record.id))
        .map((record) => toStoredSnapshot(record));
      this.queryRepository.records = this.queryRepository.records.filter(
        (record) => !matchingIds.includes(record.id)
      );
      this.queryRepository.total = this.queryRepository.records.length;
      return ok(deletedRecords.length > 0 ? { deletedRecords } : {});
    }
    return ok({});
  }

  async deleteManyStream(): Promise<Result<{ totalDeleted: number }, DomainError>> {
    return ok({ totalDeleted: 0 });
  }
}

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  records: TableRecordReadModel[] = [];
  total = 0;
  findCalls: Array<{
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
    options?: ITableRecordQueryOptions;
  }> = [];

  async find(
    _context: IExecutionContext,
    _table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    this.findCalls.push({ spec, options });
    const scopedRecords =
      spec instanceof RecordByIdsSpec
        ? this.records.filter((record) =>
            spec.recordIds().some((recordId) => recordId.toString() === record.id)
          )
        : this.records;
    const orderedRecords = options?.recordIdsOrder?.length
      ? options.recordIdsOrder
          .map((recordId) => scopedRecords.find((record) => record.id === recordId.toString()))
          .filter((record): record is TableRecordReadModel => Boolean(record))
      : scopedRecords;
    const offset = options?.pagination?.offset()?.toNumber() ?? 0;
    const limit = options?.pagination?.limit()?.toNumber() ?? orderedRecords.length;
    const pageRecords = orderedRecords.slice(offset, offset + limit);
    return ok({
      records: pageRecords,
      total:
        options?.includeTotal === false ? pageRecords.length : this.total || orderedRecords.length,
    });
  }

  async findOne(): Promise<Result<TableRecordReadModel, DomainError>> {
    return err(domainError.notFound({ message: 'Record not found' }));
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
  events: IDomainEvent[] = [];
  publishManyCalls: Array<ReadonlyArray<IDomainEvent>> = [];
  failPublishByCallIndex = new Map<number, DomainError>();

  async publish(_: IExecutionContext, event: IDomainEvent) {
    this.events.push(event);
    return ok(undefined);
  }

  async publishMany(_: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    const callIndex = this.publishManyCalls.length;
    this.publishManyCalls.push(events);
    const failure = this.failPublishByCallIndex.get(callIndex);
    if (failure) {
      return err(failure);
    }
    this.events.push(...events);
    return ok(undefined);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    return work({ ...context, transaction });
  }
}

class FakeUndoRedoService {
  recordEntryCalls: Array<{
    context: IExecutionContext;
    tableId: string;
    entry: unknown;
  }> = [];

  async recordEntry(context: IExecutionContext, tableId: TableId, entry: unknown) {
    this.recordEntryCalls.push({
      context,
      tableId: tableId.toString(),
      entry,
    });
    return ok(undefined);
  }

  async recordDelete(
    context: IExecutionContext,
    params: {
      tableId: TableId;
      deletedRecords: ReadonlyArray<{ recordId: string }>;
      deletedRecordIds?: ReadonlyArray<string>;
      groupId?: string;
    }
  ) {
    return this.recordEntry(context, params.tableId, {
      ...(params.groupId ? { groupId: params.groupId } : {}),
      undoCommand: {
        payload: {
          records: [...params.deletedRecords],
        },
      },
      redoCommand: {
        payload: {
          recordIds: [
            ...(params.deletedRecordIds ?? params.deletedRecords.map((record) => record.recordId)),
          ],
        },
      },
    });
  }

  async appendEntry(context: IExecutionContext, tableId: TableId, entry: unknown) {
    return this.recordEntry(context, tableId, entry);
  }

  async appendRecordDelete(
    context: IExecutionContext,
    params: {
      tableId: TableId;
      deletedRecords: ReadonlyArray<{ recordId: string }>;
      deletedRecordIds?: ReadonlyArray<string>;
      groupId?: string;
    }
  ) {
    return this.recordDelete(context, params);
  }
}

const createHandler = (args: {
  tableRepository: FakeTableRepository;
  queryRepository: FakeTableRecordQueryRepository;
  recordRepository?: FakeTableRecordRepository;
  eventBus?: FakeEventBus;
  undoRedoService?: FakeUndoRedoService;
  plugins?: Parameters<typeof createRecordWritePluginRunner>[0];
}) => {
  const eventBus = args.eventBus ?? new FakeEventBus();
  const undoRedoService = args.undoRedoService ?? new FakeUndoRedoService();
  const applicationService = new DeleteByRangeApplicationService(
    new TableQueryService(args.tableRepository),
    createRecordWritePluginRunner(args.plugins),
    args.recordRepository ?? new FakeTableRecordRepository(args.queryRepository),
    args.queryRepository,
    eventBus,
    undoRedoService as unknown as UndoRedoStackService,
    new FakeUnitOfWork()
  );

  return { handler: new DeleteByRangeStreamHandler(applicationService), eventBus, undoRedoService };
};

describe('DeleteByRangeStreamHandler', () => {
  it('streams progress events and a final done event', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
      { id: `rec${'c'.repeat(16)}`, fields: { title: 'Record C' }, version: 1 },
    ];
    queryRepository.total = 3;
    const originalRecordIds = queryRepository.records.map((record) => record.id);
    const recordRepository = new FakeTableRecordRepository(queryRepository);
    const eventBus = new FakeEventBus();
    const undoRedoService = new FakeUndoRedoService();
    const { plugin, calls } = createTrackedRecordWritePlugin(['deleteMany']);

    const { handler } = createHandler({
      tableRepository,
      queryRepository,
      recordRepository,
      eventBus,
      undoRedoService,
      plugins: [plugin],
    });
    const command = DeleteByRangeStreamCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 2]],
      type: 'rows',
      batchSize: 2,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(events.map((event) => event.id)).toEqual([
      'progress',
      'progress',
      'progress',
      'progress',
      'done',
    ]);
    expect(events.at(-1)).toMatchObject({
      id: 'done',
      totalCount: 3,
      deletedCount: 3,
      data: { deletedRecordIds: originalRecordIds },
    });
    expect(tableRepository.findOneCallCount).toBe(1);
    expect(recordRepository.deleteRecordIdsByBatch).toEqual([
      [originalRecordIds[0], originalRecordIds[1]],
      [originalRecordIds[2]],
    ]);
    expect(
      new Set(recordRepository.deleteContexts.map((context) => context.transaction)).size
    ).toBe(2);
    expect(queryRepository.findCalls.some((call) => call.spec instanceof RecordByIdsSpec)).toBe(
      false
    );
    expect(eventBus.publishManyCalls).toHaveLength(2);
    expect(undoRedoService.recordEntryCalls).toHaveLength(2);
    expect(
      undoRedoService.recordEntryCalls.map(
        (call) =>
          (
            call.entry as {
              undoCommand: { payload: { records: unknown[] } };
            }
          ).undoCommand.payload.records.length
      )
    ).toEqual([2, 1]);
    expect(calls.prepare).toHaveLength(3);
    expect(calls.guard).toHaveLength(3);
    expect(calls.beforePersist).toHaveLength(2);
    expect(calls.afterCommit).toHaveLength(2);
    expect(calls.prepare.map((call) => call.payload.recordCount)).toEqual([3, 2, 1]);
    expect(calls.prepareStates).toEqual([undefined, undefined, undefined]);
    expect(calls.prepare.map((call) => call.orchestration)).toEqual([
      {
        mode: 'stream',
        scope: 'operation',
        operationId: 'req-delete-stream-test',
        totalRecordCount: 3,
        totalChunkCount: 2,
      },
      {
        mode: 'stream',
        scope: 'chunk',
        operationId: 'req-delete-stream-test',
        totalRecordCount: 3,
        totalChunkCount: 2,
        chunkIndex: 0,
      },
      {
        mode: 'stream',
        scope: 'chunk',
        operationId: 'req-delete-stream-test',
        totalRecordCount: 3,
        totalChunkCount: 2,
        chunkIndex: 1,
      },
    ]);
  });

  it('allows an operation-only plugin to reuse cached state across chunks', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
      { id: `rec${'c'.repeat(16)}`, fields: { title: 'Record C' }, version: 1 },
    ];
    queryRepository.total = 3;
    const heavyPrepareScopes: string[] = [];
    const seenPreviousStates: unknown[] = [];
    const guardStates: unknown[] = [];
    const plugin = {
      name: 'operation-only-delete-plugin',
      supports: () => true,
      prepare(context, previousPreparedState) {
        seenPreviousStates.push(previousPreparedState);
        if (context.orchestration?.scope === 'operation') {
          heavyPrepareScopes.push('operation');
          return ok({ cached: 'delete-policy' });
        }

        return ok(previousPreparedState);
      },
      guard(_context, preparedState) {
        guardStates.push(preparedState);
        return ok(undefined);
      },
      beforePersist() {
        return ok(undefined);
      },
      afterCommit() {
        return ok(undefined);
      },
    };

    const { handler } = createHandler({
      tableRepository,
      queryRepository,
      plugins: [plugin],
    });
    const command = DeleteByRangeStreamCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 2]],
      type: 'rows',
      batchSize: 2,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    for await (const event of result._unsafeUnwrap()) {
      void event.id;
      // exhaust stream
    }

    expect(heavyPrepareScopes).toEqual(['operation']);
    expect(seenPreviousStates).toEqual([
      undefined,
      { cached: 'delete-policy' },
      { cached: 'delete-policy' },
    ]);
    expect(guardStates).toEqual([
      { cached: 'delete-policy' },
      { cached: 'delete-policy' },
      { cached: 'delete-policy' },
    ]);
  });

  it('emits dedicated trace spans for delete chunk phases', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [buildRecordReadModel(0)];
    queryRepository.total = 1;
    const tracer = new FakeTracer();

    const { handler } = createHandler({
      tableRepository,
      queryRepository,
    });
    const command = DeleteByRangeStreamCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 0]],
      type: 'rows',
      batchSize: 1,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(tracer), command);
    for await (const event of result._unsafeUnwrap()) {
      void event.id;
      // exhaust stream
    }

    expect(tracer.spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        'teable.DeleteByRangeApplicationService.loadDeleteChunk',
        'teable.DeleteByRangeApplicationService.deleteChunk',
        'teable.DeleteByRangeApplicationService.publishDeleteChunkEvents',
        'teable.DeleteByRangeApplicationService.recordDeleteChunkUndoRedo',
      ])
    );
  });

  it('scales the default delete chunk size for large selections when batchSize is omitted', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = Array.from({ length: 5_000 }, (_, index) =>
      buildRecordReadModel(index)
    );
    queryRepository.total = queryRepository.records.length;
    const recordRepository = new FakeTableRecordRepository(queryRepository);
    const eventBus = new FakeEventBus();
    const undoRedoService = new FakeUndoRedoService();

    const { handler } = createHandler({
      tableRepository,
      queryRepository,
      recordRepository,
      eventBus,
      undoRedoService,
    });
    const command = DeleteByRangeStreamCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 4_999]],
      type: 'rows',
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      id: 'done',
      totalCount: 5_000,
      deletedCount: 5_000,
    });
    expect(recordRepository.deleteRecordIdsByBatch).toHaveLength(20);
    expect(
      new Set(recordRepository.deleteRecordIdsByBatch.map((recordIds) => recordIds.length))
    ).toEqual(new Set([250]));
    expect(eventBus.publishManyCalls).toHaveLength(20);
    expect(undoRedoService.recordEntryCalls).toHaveLength(20);
  });

  it('continues deleting later chunks after a chunk fails and emits error details', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
      { id: `rec${'c'.repeat(16)}`, fields: { title: 'Record C' }, version: 1 },
    ];
    const originalRecordIds = queryRepository.records.map((record) => record.id);
    const recordRepository = new FakeTableRecordRepository(queryRepository);
    recordRepository.failDeleteByBatchIndex.set(
      1,
      domainError.unexpected({ message: 'delete failed' })
    );
    const eventBus = new FakeEventBus();
    const undoRedoService = new FakeUndoRedoService();

    const { handler } = createHandler({
      tableRepository,
      queryRepository,
      recordRepository,
      eventBus,
      undoRedoService,
    });
    const command = DeleteByRangeStreamCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 2]],
      type: 'rows',
      batchSize: 1,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(events.map((event) => event.id)).toEqual([
      'progress',
      'progress',
      'progress',
      'error',
      'progress',
      'done',
    ]);
    expect(events.find((event) => event.id === 'error')).toMatchObject({
      id: 'error',
      phase: 'deleting',
      batchIndex: 1,
      totalCount: 3,
      deletedCount: 1,
      recordIds: [originalRecordIds[1]],
      message: 'delete failed',
    });
    expect(events.at(-1)).toMatchObject({
      id: 'done',
      totalCount: 3,
      deletedCount: 2,
      data: {
        deletedRecordIds: [originalRecordIds[0], originalRecordIds[2]],
      },
    });
    expect(eventBus.publishManyCalls).toHaveLength(2);
    expect(undoRedoService.recordEntryCalls).toHaveLength(2);
    expect(
      undoRedoService.recordEntryCalls.map(
        (call) =>
          (
            call.entry as {
              undoCommand: { payload: { records: Array<{ recordId: string }> } };
            }
          ).undoCommand.payload.records[0]?.recordId
      )
    ).toEqual([originalRecordIds[0], originalRecordIds[2]]);
  });

  it('emits a zero-result done event and skips undo when every chunk fails', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
    ];
    queryRepository.total = 2;

    const recordRepository = new FakeTableRecordRepository(queryRepository);
    recordRepository.failDeleteByBatchIndex.set(
      0,
      domainError.unexpected({ message: 'first chunk failed' })
    );
    recordRepository.failDeleteByBatchIndex.set(
      1,
      domainError.unexpected({ message: 'second chunk failed' })
    );
    const eventBus = new FakeEventBus();
    const undoRedoService = new FakeUndoRedoService();

    const { handler } = createHandler({
      tableRepository,
      queryRepository,
      recordRepository,
      eventBus,
      undoRedoService,
    });
    const command = DeleteByRangeStreamCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 1]],
      type: 'rows',
      batchSize: 1,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(events.map((event) => event.id)).toEqual([
      'progress',
      'progress',
      'error',
      'error',
      'done',
    ]);
    expect(events.at(-1)).toMatchObject({
      id: 'done',
      totalCount: 2,
      deletedCount: 0,
      data: {
        deletedCount: 0,
        deletedRecordIds: [],
      },
    });
    expect(eventBus.publishManyCalls).toHaveLength(0);
    expect(undoRedoService.recordEntryCalls).toHaveLength(0);
  });

  it('emits publishing errors without dropping the successful delete result', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
    ];
    queryRepository.total = 1;
    const originalRecordId = queryRepository.records[0]!.id;

    const recordRepository = new FakeTableRecordRepository(queryRepository);
    const eventBus = new FakeEventBus();
    eventBus.failPublishByCallIndex.set(0, domainError.unexpected({ message: 'publish failed' }));
    const undoRedoService = new FakeUndoRedoService();

    const { handler } = createHandler({
      tableRepository,
      queryRepository,
      recordRepository,
      eventBus,
      undoRedoService,
    });
    const command = DeleteByRangeStreamCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 0]],
      type: 'rows',
      batchSize: 1,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(events.map((event) => event.id)).toEqual([
      'progress',
      'progress',
      'progress',
      'error',
      'done',
    ]);
    expect(events.find((event) => event.id === 'error')).toMatchObject({
      id: 'error',
      phase: 'publishing',
      batchIndex: 0,
      totalCount: 1,
      deletedCount: 1,
      recordIds: [originalRecordId],
      message: 'publish failed',
    });
    expect(events.at(-1)).toMatchObject({
      id: 'done',
      totalCount: 1,
      deletedCount: 1,
      data: {
        deletedCount: 1,
        deletedRecordIds: [originalRecordId],
      },
    });
    expect(undoRedoService.recordEntryCalls).toHaveLength(1);
  });
});
