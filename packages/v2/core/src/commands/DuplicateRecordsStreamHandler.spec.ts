import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { DuplicateRecordsApplicationService } from '../application/services/DuplicateRecordsApplicationService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoStackService } from '../application/services/UndoRedoStackService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { isRecordsBatchCreatedEvent } from '../domain/table/events/RecordsBatchCreated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { RecordId } from '../domain/table/records/RecordId';
import { RecordInsertOrder } from '../domain/table/records/RecordInsertOrder';
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
  InsertOptions,
  ITableRecordRepository,
  RecordMutationResult,
  RecordStoredSnapshot,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ISpan, ITracer, SpanAttributes } from '../ports/Tracer';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { DuplicateRecordsStreamCommand } from './DuplicateRecordsStreamCommand';
import { DuplicateRecordsStreamHandler } from './DuplicateRecordsStreamHandler';
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
  return { actorId, requestId: 'req-duplicate-stream-test', tracer };
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

  async restore(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  sourceRecords: TableRecordReadModel[] = [];
  persistedRecords = new Map<string, TableRecordReadModel>();
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
    if (spec instanceof RecordByIdsSpec) {
      const records = spec
        .recordIds()
        .map((recordId) => this.persistedRecords.get(recordId.toString()))
        .filter((record): record is TableRecordReadModel => Boolean(record));
      return ok({ records, total: records.length });
    }

    const offset = options?.pagination?.offset()?.toNumber() ?? 0;
    const limit = options?.pagination?.limit()?.toNumber() ?? this.sourceRecords.length;
    return ok({
      records: this.sourceRecords.slice(offset, offset + limit),
      total: this.total || this.sourceRecords.length,
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
    for (const record of this.sourceRecords) {
      yield ok(record);
    }
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  failInsertByBatchIndex = new Map<number, DomainError>();
  omitRecordSnapshotsByBatchIndex = new Set<number>();
  insertContexts: Array<IExecutionContext> = [];
  insertedRecordIdsByBatch: string[][] = [];
  private orderCounterByViewId = new Map<string, number>();

  constructor(private readonly queryRepository: FakeTableRecordQueryRepository) {}

  async insert(
    _: IExecutionContext,
    __: Table,
    ___: TableRecord
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertMany(
    context: IExecutionContext,
    __: Table,
    records: ReadonlyArray<TableRecord>,
    options?: InsertOptions
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    this.insertContexts.push(context);
    const recordIds = records.map((record) => record.id().toString());
    this.insertedRecordIdsByBatch.push(recordIds);

    const batchIndex = this.insertedRecordIdsByBatch.length - 1;
    const failure = this.failInsertByBatchIndex.get(batchIndex);
    if (failure) {
      return err(failure);
    }

    const recordOrders = new Map<string, Record<string, number>>();
    const recordSnapshots: RecordStoredSnapshot[] = [];
    const orderViewId = options?.order?.viewId.toString();

    for (const record of records) {
      const fields: Record<string, unknown> = {};
      for (const entry of record.fields().entries()) {
        fields[entry.fieldId.toString()] = entry.value.toValue();
      }

      const snapshot: TableRecordReadModel = {
        id: record.id().toString(),
        fields,
        version: 1,
      };

      if (orderViewId) {
        const nextOrder = this.orderCounterByViewId.get(orderViewId) ?? 0;
        snapshot.orders = { [orderViewId]: nextOrder };
        recordOrders.set(snapshot.id, snapshot.orders);
        this.orderCounterByViewId.set(orderViewId, nextOrder + 1);
      }

      this.queryRepository.persistedRecords.set(snapshot.id, snapshot);
      recordSnapshots.push(toStoredSnapshot(snapshot));
    }

    return ok({
      ...(recordOrders.size ? { recordOrders } : {}),
      ...(this.omitRecordSnapshotsByBatchIndex.has(batchIndex) ? {} : { recordSnapshots }),
    });
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

  async updateManyStream(): Promise<
    Result<{ totalUpdated: number; updatedRecords: [] }, DomainError>
  > {
    return ok({ totalUpdated: 0, updatedRecords: [] });
  }

  async deleteMany() {
    return ok({});
  }

  async deleteManyStream(): Promise<Result<{ totalDeleted: number }, DomainError>> {
    return ok({ totalDeleted: 0 });
  }
}

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

  async recordCreate(
    context: IExecutionContext,
    params: {
      tableId: TableId;
      createdRecords: ReadonlyArray<{ recordId: string }>;
      createdRecordIds?: ReadonlyArray<string>;
      groupId?: string;
    }
  ) {
    return this.recordEntry(context, params.tableId, {
      ...(params.groupId ? { groupId: params.groupId } : {}),
      undoCommand: {
        type: 'DeleteRecords',
        payload: {
          recordIds: [
            ...(params.createdRecordIds ?? params.createdRecords.map((record) => record.recordId)),
          ],
        },
      },
      redoCommand: {
        type: 'RestoreRecords',
        payload: {
          records: [...params.createdRecords],
        },
      },
    });
  }

  async appendEntry(context: IExecutionContext, tableId: TableId, entry: unknown) {
    return this.recordEntry(context, tableId, entry);
  }

  async appendRecordCreate(
    context: IExecutionContext,
    params: {
      tableId: TableId;
      createdRecords: ReadonlyArray<{ recordId: string }>;
      createdRecordIds?: ReadonlyArray<string>;
      groupId?: string;
    }
  ) {
    return this.recordCreate(context, params);
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

class FakeUnitOfWork implements IUnitOfWork {
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    return work({ ...context, transaction });
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
  const recordRepository =
    args.recordRepository ?? new FakeTableRecordRepository(args.queryRepository);
  const applicationService = new DuplicateRecordsApplicationService(
    new TableQueryService(args.tableRepository),
    createRecordWritePluginRunner(args.plugins),
    new RecordWriteSideEffectService(),
    recordRepository,
    args.queryRepository,
    new TableUpdateFlow(
      args.tableRepository,
      { applySchema: async () => ok(undefined) } as never,
      eventBus,
      new FakeUnitOfWork()
    ),
    eventBus,
    undoRedoService as unknown as UndoRedoStackService,
    new FakeUnitOfWork()
  );

  return {
    handler: new DuplicateRecordsStreamHandler(applicationService),
    eventBus,
    undoRedoService,
    recordRepository,
  };
};

describe('DuplicateRecordsStreamHandler', () => {
  it('streams progress events, publishes chunk events, and records batched undo commands', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.sourceRecords = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
      { id: `rec${'c'.repeat(16)}`, fields: { title: 'Record C' }, version: 1 },
    ];
    queryRepository.total = 3;
    const eventBus = new FakeEventBus();
    const undoRedoService = new FakeUndoRedoService();
    const { plugin, calls } = createTrackedRecordWritePlugin(['duplicateStream']);

    const { handler, recordRepository } = createHandler({
      tableRepository,
      queryRepository,
      eventBus,
      undoRedoService,
      plugins: [plugin],
    });

    const command = DuplicateRecordsStreamCommand.create({
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
      duplicatedCount: 3,
      data: {
        duplicatedCount: 3,
      },
    });
    expect(tableRepository.findOneCallCount).toBe(1);
    expect(recordRepository.insertedRecordIdsByBatch).toHaveLength(2);
    expect(recordRepository.insertedRecordIdsByBatch[0]).toHaveLength(2);
    expect(recordRepository.insertedRecordIdsByBatch[1]).toHaveLength(1);
    expect(
      new Set(recordRepository.insertContexts.map((context) => context.transaction)).size
    ).toBe(2);
    expect(eventBus.publishManyCalls).toHaveLength(2);
    const batchCreatedEvents = eventBus.publishManyCalls.flatMap((events) =>
      events.filter(isRecordsBatchCreatedEvent)
    );
    expect(batchCreatedEvents).toHaveLength(2);
    expect(batchCreatedEvents.map((event) => event.orchestration)).toEqual([
      {
        operationId: 'req-duplicate-stream-test',
        groupId: 'req-duplicate-stream-test',
        totalRecordCount: 3,
        totalChunkCount: 2,
        chunkIndex: 0,
        scope: 'chunk',
      },
      {
        operationId: 'req-duplicate-stream-test',
        groupId: 'req-duplicate-stream-test',
        totalRecordCount: 3,
        totalChunkCount: 2,
        chunkIndex: 1,
        scope: 'chunk',
      },
    ]);
    expect(undoRedoService.recordEntryCalls).toHaveLength(2);
    expect(
      undoRedoService.recordEntryCalls.every(
        (call) =>
          (
            call.entry as {
              undoCommand: { type: string };
              redoCommand: { type: string };
              groupId: string;
            }
          ).undoCommand.type === 'DeleteRecords'
      )
    ).toBe(true);
    expect(
      undoRedoService.recordEntryCalls.every(
        (call) =>
          (
            call.entry as {
              undoCommand: { type: string };
              redoCommand: { type: string };
              groupId: string;
            }
          ).redoCommand.type === 'RestoreRecords'
      )
    ).toBe(true);
    expect(
      new Set(
        undoRedoService.recordEntryCalls.map((call) => (call.entry as { groupId: string }).groupId)
      ).size
    ).toBe(1);
    expect(
      undoRedoService.recordEntryCalls.map(
        (call) =>
          (
            call.entry as {
              undoCommand: { payload: { recordIds: string[] } };
            }
          ).undoCommand.payload.recordIds.length
      )
    ).toEqual([2, 1]);
    expect(
      undoRedoService.recordEntryCalls.map(
        (call) =>
          (
            call.entry as {
              redoCommand: { payload: { records: unknown[] } };
            }
          ).redoCommand.payload.records.length
      )
    ).toEqual([2, 1]);
    expect(
      queryRepository.findCalls.filter((call) => call.spec instanceof RecordByIdsSpec)
    ).toHaveLength(0);
    expect(calls.prepare).toHaveLength(3);
    expect(calls.guard).toHaveLength(3);
    expect(calls.beforePersist).toHaveLength(2);
    expect(calls.afterCommit).toHaveLength(2);
    expect(calls.prepare.map((call) => call.payload.recordCount)).toEqual([3, 2, 1]);
    expect(calls.prepare.map((call) => call.payload.sourceRecordIds.length)).toEqual([0, 2, 1]);
    expect(calls.prepareStates).toEqual([undefined, undefined, undefined]);
    expect(calls.prepare.map((call) => call.orchestration)).toEqual([
      {
        mode: 'stream',
        scope: 'operation',
        operationId: 'req-duplicate-stream-test',
        totalRecordCount: 3,
        totalChunkCount: 2,
      },
      {
        mode: 'stream',
        scope: 'chunk',
        operationId: 'req-duplicate-stream-test',
        totalRecordCount: 3,
        totalChunkCount: 2,
        chunkIndex: 0,
      },
      {
        mode: 'stream',
        scope: 'chunk',
        operationId: 'req-duplicate-stream-test',
        totalRecordCount: 3,
        totalChunkCount: 2,
        chunkIndex: 1,
      },
    ]);
    expect(calls.prepare[1]?.payload.order).toBeInstanceOf(RecordInsertOrder);
    expect(calls.prepare[2]?.payload.order).toBeInstanceOf(RecordInsertOrder);
  });

  it('yields to the event loop after each duplicate chunk', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.sourceRecords = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
      { id: `rec${'c'.repeat(16)}`, fields: { title: 'Record C' }, version: 1 },
    ];
    queryRepository.total = 3;

    const { handler } = createHandler({
      tableRepository,
      queryRepository,
    });

    const command = DuplicateRecordsStreamCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 2]],
      type: 'rows',
      batchSize: 2,
    })._unsafeUnwrap();

    let yieldCount = 0;
    const immediateHolder = globalThis as typeof globalThis & {
      setImmediate?: (callback: () => void) => void;
    };
    const previousImmediate = immediateHolder.setImmediate;
    immediateHolder.setImmediate = (callback) => {
      yieldCount += 1;
      callback();
    };

    try {
      const result = await handler.handle(createContext(), command);
      for await (const event of result._unsafeUnwrap()) {
        // Drain the full stream to execute all chunk finalizers.
        void event;
      }
    } finally {
      immediateHolder.setImmediate = previousImmediate;
    }

    expect(yieldCount).toBe(2);
  });

  it('emits duplicate chunk tracing spans for load, persist, publish, undo, and yield phases', async () => {
    const tracer = new FakeTracer();
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.sourceRecords = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
      { id: `rec${'c'.repeat(16)}`, fields: { title: 'Record C' }, version: 1 },
    ];
    queryRepository.total = 3;

    const { handler } = createHandler({
      tableRepository,
      queryRepository,
    });

    const command = DuplicateRecordsStreamCommand.create({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 2]],
      type: 'rows',
      batchSize: 2,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(tracer), command);
    for await (const event of result._unsafeUnwrap()) {
      void event;
    }

    expect(tracer.spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        'teable.DuplicateRecordsApplicationService.loadDuplicateChunk',
        'teable.DuplicateRecordsApplicationService.duplicateChunk',
        'teable.DuplicateRecordsApplicationService.prepareDuplicateChunkMutation',
        'teable.DuplicateRecordsApplicationService.buildDuplicateChunkRecords',
        'teable.DuplicateRecordsApplicationService.persistDuplicateChunkMutation',
        'teable.DuplicateRecordsApplicationService.aggregateDuplicateChunkEvents',
        'teable.DuplicateRecordsApplicationService.publishDuplicateChunkEvents',
        'teable.DuplicateRecordsApplicationService.recordDuplicateChunkUndoRedo',
        'teable.DuplicateRecordsApplicationService.yieldAfterDuplicateChunk',
      ])
    );
  });

  it('allows an operation-only plugin to reuse cached state across duplicate chunks', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.sourceRecords = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
      { id: `rec${'c'.repeat(16)}`, fields: { title: 'Record C' }, version: 1 },
    ];
    queryRepository.total = 3;
    const heavyPrepareScopes: string[] = [];
    const seenPreviousStates: unknown[] = [];
    const guardStates: unknown[] = [];
    const plugin = {
      name: 'operation-only-duplicate-plugin',
      supports: () => true,
      prepare(context, previousPreparedState) {
        seenPreviousStates.push(previousPreparedState);
        if (context.orchestration?.scope === 'operation') {
          heavyPrepareScopes.push('operation');
          return ok({ cached: 'duplicate-policy' });
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
    const command = DuplicateRecordsStreamCommand.create({
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
      { cached: 'duplicate-policy' },
      { cached: 'duplicate-policy' },
    ]);
    expect(guardStates).toEqual([
      { cached: 'duplicate-policy' },
      { cached: 'duplicate-policy' },
      { cached: 'duplicate-policy' },
    ]);
  });

  it('scales the default duplicate chunk size for large selections when batchSize is omitted', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.sourceRecords = Array.from({ length: 5_000 }, (_, index) =>
      buildRecordReadModel(index)
    );
    queryRepository.total = queryRepository.sourceRecords.length;
    const eventBus = new FakeEventBus();
    const undoRedoService = new FakeUndoRedoService();

    const { handler, recordRepository } = createHandler({
      tableRepository,
      queryRepository,
      eventBus,
      undoRedoService,
    });

    const command = DuplicateRecordsStreamCommand.create({
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
      duplicatedCount: 5_000,
    });
    expect(recordRepository.insertedRecordIdsByBatch).toHaveLength(20);
    expect(
      new Set(recordRepository.insertedRecordIdsByBatch.map((recordIds) => recordIds.length))
    ).toEqual(new Set([250]));
    expect(eventBus.publishManyCalls).toHaveLength(20);
    expect(undoRedoService.recordEntryCalls).toHaveLength(20);
  });

  it('continues duplicating later chunks after a chunk fails and only records undo for created rows', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.sourceRecords = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
      { id: `rec${'c'.repeat(16)}`, fields: { title: 'Record C' }, version: 1 },
    ];
    queryRepository.total = 3;
    const recordRepository = new FakeTableRecordRepository(queryRepository);
    recordRepository.failInsertByBatchIndex.set(
      1,
      domainError.unexpected({ message: 'duplicate failed' })
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

    const command = DuplicateRecordsStreamCommand.create({
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
      phase: 'duplicating',
      batchIndex: 1,
      totalCount: 3,
      duplicatedCount: 1,
      recordIds: [queryRepository.sourceRecords[1]!.id],
      message: 'duplicate failed',
    });
    expect(events.at(-1)).toMatchObject({
      id: 'done',
      totalCount: 3,
      duplicatedCount: 2,
      data: {
        duplicatedCount: 2,
      },
    });
    expect(eventBus.publishManyCalls).toHaveLength(2);
    expect(undoRedoService.recordEntryCalls).toHaveLength(2);
    expect(
      undoRedoService.recordEntryCalls.map(
        (call) =>
          (
            call.entry as {
              undoCommand: { payload: { recordIds: string[] } };
            }
          ).undoCommand.payload.recordIds.length
      )
    ).toEqual([1, 1]);
    expect(
      new Set(
        undoRedoService.recordEntryCalls.map((call) => (call.entry as { groupId: string }).groupId)
      )
    ).toHaveProperty('size', 1);
  });

  it('emits an error when a duplicate chunk persists without stored snapshots', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.sourceRecords = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
    ];
    queryRepository.total = 1;
    const recordRepository = new FakeTableRecordRepository(queryRepository);
    recordRepository.omitRecordSnapshotsByBatchIndex.add(0);
    const eventBus = new FakeEventBus();
    const undoRedoService = new FakeUndoRedoService();

    const { handler } = createHandler({
      tableRepository,
      queryRepository,
      recordRepository,
      eventBus,
      undoRedoService,
    });

    const command = DuplicateRecordsStreamCommand.create({
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

    expect(events.map((event) => event.id)).toEqual(['progress', 'progress', 'error', 'done']);
    expect(events.find((event) => event.id === 'error')).toMatchObject({
      id: 'error',
      phase: 'duplicating',
      batchIndex: 0,
      totalCount: 1,
      duplicatedCount: 0,
      message: 'Record repository did not provide the required stored snapshot for duplicate.',
      code: 'record.stored_snapshot.unavailable',
    });
    expect(eventBus.publishManyCalls).toHaveLength(0);
    expect(undoRedoService.recordEntryCalls).toHaveLength(0);
  });

  it('emits a zero-result done event and skips undo when every chunk fails', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.sourceRecords = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
      { id: `rec${'b'.repeat(16)}`, fields: { title: 'Record B' }, version: 1 },
    ];
    queryRepository.total = 2;
    const recordRepository = new FakeTableRecordRepository(queryRepository);
    recordRepository.failInsertByBatchIndex.set(
      0,
      domainError.unexpected({ message: 'first chunk failed' })
    );
    recordRepository.failInsertByBatchIndex.set(
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

    const command = DuplicateRecordsStreamCommand.create({
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
      duplicatedCount: 0,
      data: {
        duplicatedCount: 0,
        duplicatedRecordIds: [],
      },
    });
    expect(eventBus.publishManyCalls).toHaveLength(0);
    expect(undoRedoService.recordEntryCalls).toHaveLength(0);
  });

  it('emits publishing errors without dropping successful duplicate results', async () => {
    const { table, tableId, viewId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.sourceRecords = [
      { id: `rec${'a'.repeat(16)}`, fields: { title: 'Record A' }, version: 1 },
    ];
    queryRepository.total = 1;
    const eventBus = new FakeEventBus();
    eventBus.failPublishByCallIndex.set(0, domainError.unexpected({ message: 'publish failed' }));
    const undoRedoService = new FakeUndoRedoService();

    const { handler } = createHandler({
      tableRepository,
      queryRepository,
      eventBus,
      undoRedoService,
    });

    const command = DuplicateRecordsStreamCommand.create({
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
      duplicatedCount: 1,
      message: 'publish failed',
    });
    expect(events.at(-1)).toMatchObject({
      id: 'done',
      totalCount: 1,
      duplicatedCount: 1,
      data: {
        duplicatedCount: 1,
      },
    });
    expect(undoRedoService.recordEntryCalls).toHaveLength(1);
  });
});
