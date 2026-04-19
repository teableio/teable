import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { RecordBulkUpdateService } from '../application/services/RecordBulkUpdateService';
import type { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordReorderService } from '../application/services/RecordReorderService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import type { RecordWriteUndoRedoPlanService } from '../application/services/RecordWriteUndoRedoPlanService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoStackService } from '../application/services/UndoRedoStackService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { flattenAndSpecs } from '../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { RecordReordered } from '../domain/table/events/RecordReordered';
import { isRecordsBatchUpdatedEvent } from '../domain/table/events/RecordsBatchUpdated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { RecordId } from '../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IRecordOrderCalculator } from '../ports/RecordOrderCalculator';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type {
  ITableRecordRepository,
  RecordMutationResult,
  BatchRecordMutationResult,
  UpdateManyStreamBatchInput,
  UpdateManyResult,
  UpdateManyStreamResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import {
  createRecordWritePluginRunner,
  createTrackedRecordWritePlugin,
  expectRecordWritePluginToBeSkipped,
} from './recordWritePluginRunnerTestUtils';
import { UpdateRecordsCommand } from './UpdateRecordsCommand';
import { UpdateRecordsHandler } from './UpdateRecordsHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId, windowId: 'test-window' };
};

const createTableUpdateFlow = (
  tableRepository: FakeTableRepository,
  eventBus: FakeEventBus,
  unitOfWork: FakeUnitOfWork
) => new TableUpdateFlow(tableRepository, new FakeTableSchemaRepository(), eventBus, unitOfWork);

const noopRecordWriteUndoRedoPlanService = {
  captureSelectOptionSideEffects: async () => ok({ undoCommands: [], redoCommands: [] }),
} as unknown as RecordWriteUndoRedoPlanService;

const buildTable = () => {
  const baseId = BaseId.create(`bse${'u'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Bulk Update Records')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
  const numberFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
  const singleSelectFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();

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
  builder
    .field()
    .singleSelect()
    .withId(singleSelectFieldId)
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([])
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    tableId,
    textFieldId,
    numberFieldId,
    singleSelectFieldId,
  };
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  updated: Table[] = [];

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
    table: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    this.updated.push(table);
    return ok(undefined);
  }

  async restore(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
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
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  updateManyCalls = 0;
  updateManyStreamCalls = 0;
  lastSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined;
  lastMutateSpec: ICellValueSpec | undefined;
  lastUpdateManyStreamBatches: UpdateManyStreamBatchInput[] = [];
  updateManyStreamVersions = new Map<string, number>();
  updateManyStreamUpdatedRecordIds: Set<string> | undefined;
  updateManyResult: UpdateManyResult = {
    totalUpdated: 0,
    updatedRecordIds: [],
    updatedRecords: [],
  };

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
    ___: Iterable<ReadonlyArray<TableRecord>>
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    return ok({ totalInserted: 0 });
  }

  async updateOne(): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async updateMany(
    _: IExecutionContext,
    __: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    mutateSpec: ICellValueSpec
  ): Promise<Result<UpdateManyResult, DomainError>> {
    this.updateManyCalls += 1;
    this.lastSpec = spec;
    this.lastMutateSpec = mutateSpec;
    return ok(this.updateManyResult);
  }

  async updateManyStream(
    _: IExecutionContext,
    __: Table,
    batches:
      | Iterable<Result<UpdateManyStreamBatchInput, DomainError>>
      | AsyncIterable<Result<UpdateManyStreamBatchInput, DomainError>>
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    this.updateManyStreamCalls += 1;
    this.lastUpdateManyStreamBatches = [];
    let totalUpdated = 0;
    const updatedRecords: Array<NonNullable<UpdateManyStreamResult['updatedRecords']>[number]> = [];

    if (Symbol.asyncIterator in batches) {
      for await (const batch of batches as AsyncIterable<
        Result<UpdateManyStreamBatchInput, DomainError>
      >) {
        if (batch.isErr()) {
          return err(batch.error);
        }
        this.lastUpdateManyStreamBatches.push(batch.value);
        const updates = Array.isArray(batch.value)
          ? batch.value
          : 'updates' in batch.value
            ? batch.value.updates
            : [];
        totalUpdated += updates.length;
        for (const update of updates) {
          const recordId = update.record.id();
          if (
            this.updateManyStreamUpdatedRecordIds &&
            !this.updateManyStreamUpdatedRecordIds.has(recordId.toString())
          ) {
            totalUpdated -= 1;
            continue;
          }
          updatedRecords.push({
            recordId,
            oldVersion: 0,
            newVersion: this.updateManyStreamVersions.get(recordId.toString()) ?? 1,
            oldFieldValues: {},
          });
        }
      }
    } else {
      for (const batch of batches as Iterable<Result<UpdateManyStreamBatchInput, DomainError>>) {
        if (batch.isErr()) {
          return err(batch.error);
        }
        this.lastUpdateManyStreamBatches.push(batch.value);
        const updates = Array.isArray(batch.value)
          ? batch.value
          : 'updates' in batch.value
            ? batch.value.updates
            : [];
        totalUpdated += updates.length;
        for (const update of updates) {
          const recordId = update.record.id();
          if (
            this.updateManyStreamUpdatedRecordIds &&
            !this.updateManyStreamUpdatedRecordIds.has(recordId.toString())
          ) {
            totalUpdated -= 1;
            continue;
          }
          updatedRecords.push({
            recordId,
            oldVersion: 0,
            newVersion: this.updateManyStreamVersions.get(recordId.toString()) ?? 1,
            oldFieldValues: {},
          });
        }
      }
    }

    return ok({ totalUpdated, updatedRecords });
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

class FakeRecordMutationSpecResolverService {
  needsResolution(_: ICellValueSpec): Result<boolean, DomainError> {
    return ok(false);
  }

  async resolveAndReplace(
    _: IExecutionContext,
    spec: ICellValueSpec
  ): Promise<Result<ICellValueSpec, DomainError>> {
    return ok(spec);
  }

  async resolveAndReplaceMany(
    _: IExecutionContext,
    specs: ReadonlyArray<ICellValueSpec | null>
  ): Promise<Result<ReadonlyArray<ICellValueSpec | null>, DomainError>> {
    return ok(specs);
  }
}

type FakeQueryRecord = {
  id: string;
  fields: Record<string, unknown>;
  version: number;
  autoNumber?: number;
  orders?: Record<string, number>;
};

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  records: FakeQueryRecord[] = [];

  async find(): Promise<Result<{ records: FakeQueryRecord[]; total: number }, DomainError>> {
    return ok({
      records: [...this.records],
      total: this.records.length,
    });
  }

  async findOne(): Promise<Result<FakeQueryRecord, DomainError>> {
    const record = this.records[0];
    if (!record) {
      return err(domainError.notFound({ message: 'Record not found' }));
    }
    return ok(record);
  }

  async *findStream(): AsyncIterable<Result<FakeQueryRecord, DomainError>> {
    for (const record of this.records) {
      yield ok(record);
    }
  }
}

class FakeRecordOrderCalculator implements IRecordOrderCalculator {
  orderValues: number[] = [];

  async calculateOrders(): Promise<Result<ReadonlyArray<number>, DomainError>> {
    return ok(this.orderValues);
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

class FakeUndoRedoService {
  entries: unknown[] = [];

  async recordEntry(_context: IExecutionContext, _tableId: TableId, entry: unknown) {
    this.entries.push(entry);
    return ok(undefined);
  }

  async appendEntry(_context: IExecutionContext, _tableId: TableId, entry: unknown) {
    this.entries.push(entry);
    return ok(undefined);
  }
}

const createHandler = (
  tableRepository: FakeTableRepository,
  recordRepository: FakeTableRecordRepository,
  eventBus: FakeEventBus,
  unitOfWork: FakeUnitOfWork,
  undoRedoService: FakeUndoRedoService,
  options?: {
    queryRepository?: FakeTableRecordQueryRepository;
    orderCalculator?: FakeRecordOrderCalculator;
    plugins?: Parameters<typeof createRecordWritePluginRunner>[0];
  }
) => {
  const orderCalculator = options?.orderCalculator ?? new FakeRecordOrderCalculator();
  const recordReorderService = new RecordReorderService(recordRepository, orderCalculator);
  const recordBulkUpdateService = new RecordBulkUpdateService(
    recordRepository,
    options?.queryRepository ?? new FakeTableRecordQueryRepository(),
    new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
    recordReorderService,
    createRecordWritePluginRunner(options?.plugins),
    new RecordWriteSideEffectService(),
    noopRecordWriteUndoRedoPlanService,
    createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
    eventBus,
    undoRedoService as unknown as UndoRedoStackService,
    new NoopLogger(),
    unitOfWork
  );

  return new UpdateRecordsHandler(new TableQueryService(tableRepository), recordBulkUpdateService);
};

describe('UpdateRecordsHandler', () => {
  it('updates matched records and publishes batch event', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const recordIdA = `rec${'a'.repeat(16)}`;
    const recordIdB = `rec${'b'.repeat(16)}`;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const recordRepository = new FakeTableRecordRepository();
    recordRepository.updateManyResult = {
      totalUpdated: 2,
      updatedRecordIds: [
        RecordId.create(recordIdA)._unsafeUnwrap(),
        RecordId.create(recordIdB)._unsafeUnwrap(),
      ],
      updatedRecords: [
        {
          recordId: RecordId.create(recordIdA)._unsafeUnwrap(),
          oldVersion: 2,
          newVersion: 3,
          oldFieldValues: { [numberFieldId.toString()]: 1 },
        },
        {
          recordId: RecordId.create(recordIdB)._unsafeUnwrap(),
          oldVersion: 7,
          newVersion: 8,
          oldFieldValues: { [numberFieldId.toString()]: 2 },
        },
      ],
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService
    );

    const command = UpdateRecordsCommand.create({
      tableId: tableId.toString(),
      fields: { [numberFieldId.toString()]: 99 },
      filter: {
        fieldId: textFieldId.toString(),
        operator: 'contains',
        value: 'task',
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const payload = result._unsafeUnwrap();

    expect(payload.updatedCount).toBe(2);
    expect(recordRepository.updateManyCalls).toBe(1);
    expect(recordRepository.lastSpec).toBeDefined();
    expect(recordRepository.lastMutateSpec).toBeDefined();
    expect(unitOfWork.transactions).toHaveLength(1);
    expect(undoRedoService.entries).toHaveLength(1);

    const batchEvent = eventBus.published.find(isRecordsBatchUpdatedEvent);
    expect(batchEvent).toBeDefined();
    expect(batchEvent?.updates).toHaveLength(2);
    expect(batchEvent?.updates[0]?.changes).toMatchObject([
      {
        fieldId: numberFieldId.toString(),
        oldValue: 1,
        newValue: 99,
      },
    ]);
  });

  it('skips plugins that do not support updateMany', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const recordId = `rec${'z'.repeat(16)}`;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const recordRepository = new FakeTableRecordRepository();
    recordRepository.updateManyResult = {
      totalUpdated: 1,
      updatedRecordIds: [RecordId.create(recordId)._unsafeUnwrap()],
      updatedRecords: [
        {
          recordId: RecordId.create(recordId)._unsafeUnwrap(),
          oldVersion: 1,
          newVersion: 2,
          oldFieldValues: { [numberFieldId.toString()]: 1 },
        },
      ],
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const { plugin, calls } = createTrackedRecordWritePlugin([RecordWriteOperationKind.createOne]);

    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService,
      {
        plugins: [plugin],
      }
    );

    const command = UpdateRecordsCommand.create({
      tableId: tableId.toString(),
      fields: { [numberFieldId.toString()]: 99 },
      filter: {
        fieldId: textFieldId.toString(),
        operator: 'contains',
        value: 'task',
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    result._unsafeUnwrap();

    expectRecordWritePluginToBeSkipped(calls, RecordWriteOperationKind.updateMany);
  });

  it('uses RecordByIdsSpec when recordIds are provided', async () => {
    const { table, tableId, numberFieldId } = buildTable();
    const recordIdA = `rec${'c'.repeat(16)}`;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const recordRepository = new FakeTableRecordRepository();
    recordRepository.updateManyResult = {
      totalUpdated: 1,
      updatedRecordIds: [RecordId.create(recordIdA)._unsafeUnwrap()],
      updatedRecords: [
        {
          recordId: RecordId.create(recordIdA)._unsafeUnwrap(),
          oldVersion: 4,
          newVersion: 5,
          oldFieldValues: { [numberFieldId.toString()]: 10 },
        },
      ],
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService
    );

    const command = UpdateRecordsCommand.create({
      tableId: tableId.toString(),
      fields: { [numberFieldId.toString()]: 99 },
      recordIds: [recordIdA],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrap().updatedCount).toBe(1);
    expect(recordRepository.lastSpec).toBeInstanceOf(RecordByIdsSpec);
    expect(
      (recordRepository.lastSpec as RecordByIdsSpec)
        .recordIds()
        .map((recordId) => recordId.toString())
    ).toEqual([recordIdA]);
    expect(eventBus.published.some(isRecordsBatchUpdatedEvent)).toBe(true);
    expect(undoRedoService.entries).toHaveLength(1);
  });

  it('composes explicit recordIds with plugin scope', async () => {
    const { table, tableId, numberFieldId } = buildTable();
    const recordIdA = `rec${'q'.repeat(16)}`;
    const scopedSpec = {
      isSatisfiedBy: () => true,
      mutate: (candidate: TableRecord) => ok(candidate),
      accept: () => ok(undefined),
    } satisfies ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const recordRepository = new FakeTableRecordRepository();
    recordRepository.updateManyResult = {
      totalUpdated: 1,
      updatedRecordIds: [RecordId.create(recordIdA)._unsafeUnwrap()],
      updatedRecords: [
        {
          recordId: RecordId.create(recordIdA)._unsafeUnwrap(),
          oldVersion: 1,
          newVersion: 2,
          oldFieldValues: { [numberFieldId.toString()]: 10 },
        },
      ],
    };
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const plugin = {
      name: 'scoped-update',
      supports: (operation: RecordWriteOperationKind) =>
        operation === RecordWriteOperationKind.updateMany,
      scope: () => ok({ recordSpec: scopedSpec }),
    };

    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService,
      {
        plugins: [plugin],
      }
    );

    const command = UpdateRecordsCommand.create({
      tableId: tableId.toString(),
      fields: { [numberFieldId.toString()]: 99 },
      recordIds: [recordIdA],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    const specs = flattenAndSpecs(recordRepository.lastSpec);
    expect(specs.some((spec) => spec instanceof RecordByIdsSpec)).toBe(true);
    expect(specs).toContain(scopedSpec);
  });

  it('updates explicit records through updateManyStream', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const recordIdA = `rec${'m'.repeat(16)}`;
    const recordIdB = `rec${'n'.repeat(16)}`;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new FakeTableRecordRepository();
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      {
        id: recordIdA,
        version: 2,
        fields: {
          [numberFieldId.toString()]: 1,
          [textFieldId.toString()]: 'before-a',
        },
      },
      {
        id: recordIdB,
        version: 5,
        fields: {
          [numberFieldId.toString()]: 2,
          [textFieldId.toString()]: 'before-b',
        },
      },
    ];

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const { plugin, calls } = createTrackedRecordWritePlugin([RecordWriteOperationKind.updateMany]);
    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService,
      {
        queryRepository,
        plugins: [plugin],
      }
    );

    const result = await handler.handle(
      createContext(),
      UpdateRecordsCommand.create({
        tableId: tableId.toString(),
        fieldKeyType: 'id',
        records: [
          {
            id: recordIdA,
            fields: { [numberFieldId.toString()]: 99 },
          },
          {
            id: recordIdB,
            fields: { [textFieldId.toString()]: 'after-b' },
          },
        ],
      })._unsafeUnwrap()
    );

    const payload = result._unsafeUnwrap();

    expect(payload.updatedCount).toBe(2);
    expect(
      payload.records?.map((record) => ({
        id: record.id().toString(),
        fields: Object.fromEntries(
          record
            .fields()
            .entries()
            .map((entry) => [entry.fieldId.toString(), entry.value.toValue()])
        ),
      }))
    ).toMatchObject([
      {
        id: recordIdA,
        fields: {
          [numberFieldId.toString()]: 99,
          [textFieldId.toString()]: 'before-a',
        },
      },
      {
        id: recordIdB,
        fields: {
          [numberFieldId.toString()]: 2,
          [textFieldId.toString()]: 'after-b',
        },
      },
    ]);
    expect(recordRepository.updateManyCalls).toBe(0);
    expect(recordRepository.updateManyStreamCalls).toBe(1);
    expect(calls.prepare[0]?.payload).toMatchObject({
      variant: 'explicit',
      recordCount: 2,
      recordIds: [
        RecordId.create(recordIdA)._unsafeUnwrap(),
        RecordId.create(recordIdB)._unsafeUnwrap(),
      ],
    });
    expect(calls.prepare[0]?.payload).toHaveProperty('recordUpdates');

    const batchEvent = eventBus.published.find(isRecordsBatchUpdatedEvent);
    expect(batchEvent?.updates.map((update) => update.changes)).toMatchObject([
      [
        {
          fieldId: numberFieldId.toString(),
          oldValue: 1,
          newValue: 99,
        },
      ],
      [
        {
          fieldId: textFieldId.toString(),
          oldValue: 'before-b',
          newValue: 'after-b',
        },
      ],
    ]);
  });

  it('uses repository-returned versions for explicit bulk-update events', async () => {
    const { table, tableId, numberFieldId } = buildTable();
    const recordId = `rec${'w'.repeat(16)}`;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new FakeTableRecordRepository();
    recordRepository.updateManyStreamVersions.set(recordId, 17);
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      {
        id: recordId,
        version: 3,
        fields: { [numberFieldId.toString()]: 1 },
      },
    ];

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService,
      {
        queryRepository,
      }
    );

    const result = await handler.handle(
      createContext(),
      UpdateRecordsCommand.create({
        tableId: tableId.toString(),
        fieldKeyType: 'id',
        records: [{ id: recordId, fields: { [numberFieldId.toString()]: 99 } }],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().updatedCount).toBe(1);
    const batchEvent = eventBus.published.find(isRecordsBatchUpdatedEvent);
    expect(batchEvent?.updates[0]).toMatchObject({
      recordId,
      oldVersion: 3,
      newVersion: 17,
    });
  });

  it('does not publish explicit update events for rows skipped by storage as no-ops', async () => {
    const { table, tableId, numberFieldId } = buildTable();
    const recordId = `rec${'x'.repeat(16)}`;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new FakeTableRecordRepository();
    recordRepository.updateManyStreamUpdatedRecordIds = new Set();
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      {
        id: recordId,
        version: 3,
        fields: { [numberFieldId.toString()]: 1 },
      },
    ];

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService,
      {
        queryRepository,
      }
    );

    const result = await handler.handle(
      createContext(),
      UpdateRecordsCommand.create({
        tableId: tableId.toString(),
        fieldKeyType: 'id',
        records: [{ id: recordId, fields: { [numberFieldId.toString()]: 1 } }],
      })._unsafeUnwrap()
    );

    const payload = result._unsafeUnwrap();
    expect(payload.updatedCount).toBe(0);
    expect(recordRepository.updateManyStreamCalls).toBe(1);
    expect(eventBus.published.some(isRecordsBatchUpdatedEvent)).toBe(false);
    expect(undoRedoService.entries).toHaveLength(0);
  });

  it('skips explicit records that are missing from storage while updating the rest', async () => {
    const { table, tableId, numberFieldId } = buildTable();
    const existingRecordId = `rec${'h'.repeat(16)}`;
    const missingRecordId = `rec${'i'.repeat(16)}`;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new FakeTableRecordRepository();
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      {
        id: existingRecordId,
        version: 3,
        fields: {
          [numberFieldId.toString()]: 12,
        },
      },
    ];
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService,
      {
        queryRepository,
      }
    );

    const result = await handler.handle(
      createContext(),
      UpdateRecordsCommand.create({
        tableId: tableId.toString(),
        fieldKeyType: 'id',
        records: [
          {
            id: existingRecordId,
            fields: { [numberFieldId.toString()]: 99 },
          },
          {
            id: missingRecordId,
            fields: { [numberFieldId.toString()]: 100 },
          },
        ],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().updatedCount).toBe(1);
    expect(recordRepository.updateManyStreamCalls).toBe(1);
    const batchEvent = eventBus.published.find(isRecordsBatchUpdatedEvent);
    expect(batchEvent?.updates).toHaveLength(1);
    expect(batchEvent?.updates[0]?.recordId).toBe(existingRecordId);
  });

  it('filters explicit records through plugin scope before persisting', async () => {
    const { table, tableId, numberFieldId } = buildTable();
    const allowedRecordId = `rec${'j'.repeat(16)}`;
    const blockedRecordId = `rec${'k'.repeat(16)}`;
    const scopedSpec = {
      isSatisfiedBy: (record: TableRecord) => record.id().toString() === allowedRecordId,
      mutate: (candidate: TableRecord) => ok(candidate),
      accept: () => ok(undefined),
    } satisfies ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new FakeTableRecordRepository();
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      {
        id: allowedRecordId,
        version: 1,
        fields: { [numberFieldId.toString()]: 10 },
      },
      {
        id: blockedRecordId,
        version: 1,
        fields: { [numberFieldId.toString()]: 20 },
      },
    ];
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const plugin = {
      name: 'explicit-scope',
      supports: (operation: RecordWriteOperationKind) =>
        operation === RecordWriteOperationKind.updateMany,
      scope: () => ok({ recordSpec: scopedSpec }),
    };
    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService,
      {
        queryRepository,
        plugins: [plugin],
      }
    );

    const result = await handler.handle(
      createContext(),
      UpdateRecordsCommand.create({
        tableId: tableId.toString(),
        fieldKeyType: 'id',
        records: [
          {
            id: allowedRecordId,
            fields: { [numberFieldId.toString()]: 99 },
          },
          {
            id: blockedRecordId,
            fields: { [numberFieldId.toString()]: 88 },
          },
        ],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().updatedCount).toBe(1);
    expect(recordRepository.updateManyStreamCalls).toBe(1);
    const streamedUpdates = recordRepository.lastUpdateManyStreamBatches.flatMap((batch) => {
      if (Array.isArray(batch)) {
        return batch;
      }
      return 'updates' in batch ? batch.updates : [];
    });
    expect(streamedUpdates).toHaveLength(1);
    expect(streamedUpdates[0]?.record.id().toString()).toBe(allowedRecordId);
  });

  it('reorders explicit records through native v2 updateRecords', async () => {
    const { table, tableId, numberFieldId } = buildTable();
    const recordIdA = `rec${'o'.repeat(16)}`;
    const recordIdB = `rec${'p'.repeat(16)}`;
    const viewId = `viw${'q'.repeat(16)}`;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new FakeTableRecordRepository();
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      {
        id: recordIdA,
        version: 1,
        fields: { [numberFieldId.toString()]: 1 },
        autoNumber: 10,
        orders: { [viewId]: 10 },
      },
      {
        id: recordIdB,
        version: 2,
        fields: { [numberFieldId.toString()]: 2 },
        autoNumber: 20,
        orders: { [viewId]: 20 },
      },
    ];
    const orderCalculator = new FakeRecordOrderCalculator();
    orderCalculator.orderValues = [100, 101];

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService,
      {
        queryRepository,
        orderCalculator,
      }
    );

    const result = await handler.handle(
      createContext(),
      UpdateRecordsCommand.create({
        tableId: tableId.toString(),
        fieldKeyType: 'id',
        records: [
          { id: recordIdA, fields: {} },
          { id: recordIdB, fields: {} },
        ],
        order: {
          viewId,
          anchorId: recordIdA,
          position: 'after',
        },
      })._unsafeUnwrap()
    );

    const payload = result._unsafeUnwrap();

    expect(payload.updatedCount).toBe(2);
    expect(
      payload.records?.map((record) => ({
        id: record.id().toString(),
        fields: Object.fromEntries(
          record
            .fields()
            .entries()
            .map((entry) => [entry.fieldId.toString(), entry.value.toValue()])
        ),
      }))
    ).toMatchObject([
      {
        id: recordIdA,
        fields: {
          [numberFieldId.toString()]: 1,
        },
      },
      {
        id: recordIdB,
        fields: {
          [numberFieldId.toString()]: 2,
        },
      },
    ]);
    expect(recordRepository.updateManyStreamCalls).toBe(1);
    expect(eventBus.published.some((event) => event instanceof RecordReordered)).toBe(true);
    expect(eventBus.published.some(isRecordsBatchUpdatedEvent)).toBe(false);
    expect(undoRedoService.entries).toHaveLength(1);
  });

  it('propagates typecast side effects for explicit updates before persisting rows', async () => {
    const { table, tableId, singleSelectFieldId } = buildTable();
    const recordId = `rec${'r'.repeat(16)}`;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new FakeTableRecordRepository();
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.records = [
      {
        id: recordId,
        version: 1,
        fields: { [singleSelectFieldId.toString()]: null },
      },
    ];

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService,
      {
        queryRepository,
      }
    );

    const result = await handler.handle(
      createContext(),
      UpdateRecordsCommand.create({
        tableId: tableId.toString(),
        fieldKeyType: 'id',
        typecast: true,
        records: [
          {
            id: recordId,
            fields: { [singleSelectFieldId.toString()]: 'Closed' },
          },
        ],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().updatedCount).toBe(1);
    expect(tableRepository.updated).toHaveLength(1);
    expect(eventBus.published.some(isRecordsBatchUpdatedEvent)).toBe(true);
  });

  it('returns early when the filter matches no records', async () => {
    const { table, tableId, textFieldId, singleSelectFieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();
    const handler = createHandler(
      tableRepository,
      recordRepository,
      eventBus,
      unitOfWork,
      undoRedoService
    );

    const command = UpdateRecordsCommand.create({
      tableId: tableId.toString(),
      typecast: true,
      fields: { [singleSelectFieldId.toString()]: 'Closed' },
      filter: {
        fieldId: textFieldId.toString(),
        operator: 'is',
        value: 'missing',
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrap().updatedCount).toBe(0);
    expect(recordRepository.updateManyCalls).toBe(1);
    expect(tableRepository.updated).toHaveLength(0);
    expect(eventBus.published.some(isRecordsBatchUpdatedEvent)).toBe(false);
    expect(undoRedoService.entries).toHaveLength(0);
  });
});
