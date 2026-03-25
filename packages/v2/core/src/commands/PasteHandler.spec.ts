import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import type { RecordWriteUndoRedoPlanService } from '../application/services/RecordWriteUndoRedoPlanService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoService } from '../application/services/UndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldOptionsAdded } from '../domain/table/events/FieldOptionsAdded';
import { RecordsBatchUpdated } from '../domain/table/events/RecordsBatchUpdated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
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
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type {
  ITableRecordRepository,
  RecordMutationResult,
  BatchRecordMutationResult,
  InsertManyStreamBatchInput,
  InsertManyStreamOptions,
  UpdateManyStreamBatchInput,
} from '../ports/TableRecordRepository';
import { isInsertManyStreamBatch, isUpdateManyStreamBatch } from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { PasteCommand } from './PasteCommand';
import { PasteHandler } from './PasteHandler';
import {
  createRecordWritePluginRunner,
  createTrackedRecordWritePlugin,
  expectRecordWritePluginToBeSkipped,
} from './recordWritePluginRunnerTestUtils';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const noopUndoRedoService = {
  recordEntry: async () => ok(undefined),
} as unknown as UndoRedoService;

const noopRecordWriteUndoRedoPlanService = {
  captureSelectOptionSideEffects: async () => ok({ undoCommands: [], redoCommands: [] }),
} as unknown as RecordWriteUndoRedoPlanService;

const createTableUpdateFlow = (
  tableRepository: FakeTableRepository,
  eventBus: FakeEventBus,
  unitOfWork: FakeUnitOfWork
) => new TableUpdateFlow(tableRepository, new FakeTableSchemaRepository(), eventBus, unitOfWork);

const buildTable = () => {
  const baseId = BaseId.create(`bse${'u'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Paste Test')._unsafeUnwrap();
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

  return {
    table: builder.build()._unsafeUnwrap(),
    baseId,
    tableId,
    textFieldId,
    numberFieldId,
  };
};

const buildTableWithSingleSelect = () => {
  const baseId = BaseId.create(`bse${'q'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'w'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Paste Select Test')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
  const singleSelectFieldId = FieldId.create(`fld${'r'.repeat(16)}`)._unsafeUnwrap();
  const openOption = SelectOption.create({ name: 'Open', color: 'blue' })._unsafeUnwrap();

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
    .singleSelect()
    .withId(singleSelectFieldId)
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([openOption])
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    baseId,
    tableId,
    textFieldId,
    singleSelectFieldId,
  };
};

const buildTableWithUser = () => {
  const baseId = BaseId.create(`bse${'m'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'p'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Paste User Test')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
  const userFieldId = FieldId.create(`fld${'w'.repeat(16)}`)._unsafeUnwrap();

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
    .user()
    .withId(userFieldId)
    .withName(FieldName.create('Assignee')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    baseId,
    tableId,
    textFieldId,
    userFieldId,
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
    const index = this.tables.findIndex((entry) => entry.id().equals(table.id()));
    if (index >= 0) {
      this.tables[index] = table;
    }
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
  inserted: TableRecord[] = [];
  updated: RecordUpdateResult[] = [];
  insertCalls = 0;
  updateCalls = 0;

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
    batches: Iterable<InsertManyStreamBatchInput> | AsyncIterable<InsertManyStreamBatchInput>,
    options?: InsertManyStreamOptions
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    this.insertCalls += 1;
    let totalInserted = 0;
    let batchIndex = 0;
    const normalizeBatch = (batch: InsertManyStreamBatchInput): ReadonlyArray<TableRecord> =>
      isInsertManyStreamBatch(batch) ? batch.records : batch;
    if (Symbol.asyncIterator in batches) {
      for await (const batch of batches as AsyncIterable<InsertManyStreamBatchInput>) {
        const records = normalizeBatch(batch);
        this.inserted.push(...records);
        totalInserted += records.length;
        options?.onBatchInserted?.({ batchIndex, insertedCount: records.length, totalInserted });
        batchIndex += 1;
      }
    } else {
      for (const batch of batches as Iterable<InsertManyStreamBatchInput>) {
        const records = normalizeBatch(batch);
        this.inserted.push(...records);
        totalInserted += records.length;
        options?.onBatchInserted?.({ batchIndex, insertedCount: records.length, totalInserted });
        batchIndex += 1;
      }
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
    batches:
      | Iterable<Result<UpdateManyStreamBatchInput, DomainError>>
      | AsyncIterable<Result<UpdateManyStreamBatchInput, DomainError>>
  ): Promise<Result<{ totalUpdated: number }, DomainError>> {
    this.updateCalls += 1;
    let totalUpdated = 0;
    const normalizeBatch = (
      batch: UpdateManyStreamBatchInput
    ): ReadonlyArray<RecordUpdateResult> =>
      isUpdateManyStreamBatch(batch) ? batch.updates : batch;

    if (Symbol.asyncIterator in batches) {
      for await (const batchResult of batches as AsyncIterable<
        Result<UpdateManyStreamBatchInput, DomainError>
      >) {
        if (batchResult.isErr()) {
          return err(batchResult.error);
        }
        for (const update of normalizeBatch(batchResult.value)) {
          this.updated.push(update);
          totalUpdated += 1;
        }
      }
    } else {
      for (const batchResult of batches as Iterable<
        Result<UpdateManyStreamBatchInput, DomainError>
      >) {
        if (batchResult.isErr()) {
          return err(batchResult.error);
        }
        for (const update of normalizeBatch(batchResult.value)) {
          this.updated.push(update);
          totalUpdated += 1;
        }
      }
    }
    return ok({ totalUpdated });
  }

  async deleteMany(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  records: TableRecordReadModel[] = [];

  async find(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>> {
    return ok({ records: this.records, total: this.records.length });
  }

  async findOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    if (this.records.length === 0)
      return err(domainError.notFound({ message: 'Record not found' }));
    return ok(this.records[0]!);
  }

  findStream(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    const records = this.records;
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const record of records) {
          yield ok(record);
        }
      },
    };
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

class CountingRecordMutationSpecResolverService extends FakeRecordMutationSpecResolverService {
  resolveAndReplaceCalls = 0;
  resolveAndReplaceManyCalls = 0;
  resolvedBatchSizes: number[] = [];

  override needsResolution(_: ICellValueSpec): Result<boolean, DomainError> {
    return ok(true);
  }

  override async resolveAndReplace(
    _: IExecutionContext,
    spec: ICellValueSpec
  ): Promise<Result<ICellValueSpec, DomainError>> {
    this.resolveAndReplaceCalls += 1;
    return ok(spec);
  }

  override async resolveAndReplaceMany(
    _: IExecutionContext,
    specs: ReadonlyArray<ICellValueSpec | null>
  ): Promise<Result<ReadonlyArray<ICellValueSpec | null>, DomainError>> {
    this.resolveAndReplaceManyCalls += 1;
    this.resolvedBatchSizes.push(specs.length);
    return ok(specs);
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
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    const transactionContext = { ...context, transaction };
    return work(transactionContext);
  }
}

class FakeForeignTableLoaderService {
  async load() {
    return ok([]);
  }
}

class FakeFieldCreationSideEffectService {
  async execute() {
    return ok({ events: [], tableState: new Map() });
  }
}

describe('PasteHandler', () => {
  describe('event version', () => {
    it('publishes RecordsBatchUpdated with correct oldVersion and newVersion from existing record', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const viewId = table.views()[0]!.id();

      // Create record with version 5
      const existingVersion = 5;
      const recordId = `rec${'r'.repeat(16)}`;

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: recordId,
          fields: { [textFieldId.toString()]: 'Old Title' },
          version: existingVersion,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['New Title']],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      expect(result.isOk()).toBe(true);

      // Find the RecordsBatchUpdated event
      const batchUpdatedEvent = eventBus.published.find(
        (event) => event instanceof RecordsBatchUpdated
      ) as RecordsBatchUpdated | undefined;

      expect(batchUpdatedEvent).toBeDefined();
      expect(batchUpdatedEvent!.updates).toHaveLength(1);

      const update = batchUpdatedEvent!.updates[0]!;
      expect(update.recordId).toBe(recordId);
      expect(update.oldVersion).toBe(existingVersion);
      expect(update.newVersion).toBe(existingVersion + 1);
    });

    it('publishes correct versions for multiple records with different versions', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const viewId = table.views()[0]!.id();

      // Create records with different versions
      const record1 = {
        id: `rec${'1'.repeat(16)}`,
        fields: { [textFieldId.toString()]: 'Title 1' },
        version: 3,
      };
      const record2 = {
        id: `rec${'2'.repeat(16)}`,
        fields: { [textFieldId.toString()]: 'Title 2' },
        version: 7,
      };
      const record3 = {
        id: `rec${'3'.repeat(16)}`,
        fields: { [textFieldId.toString()]: 'Title 3' },
        version: 12,
      };

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [record1, record2, record3];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['Updated 1'], ['Updated 2'], ['Updated 3']],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      expect(result.isOk()).toBe(true);

      const batchUpdatedEvent = eventBus.published.find(
        (event) => event instanceof RecordsBatchUpdated
      ) as RecordsBatchUpdated | undefined;

      expect(batchUpdatedEvent).toBeDefined();
      expect(batchUpdatedEvent!.updates).toHaveLength(3);

      // Verify each record has correct version
      const update1 = batchUpdatedEvent!.updates.find((u) => u.recordId === record1.id);
      expect(update1?.oldVersion).toBe(3);
      expect(update1?.newVersion).toBe(4);

      const update2 = batchUpdatedEvent!.updates.find((u) => u.recordId === record2.id);
      expect(update2?.oldVersion).toBe(7);
      expect(update2?.newVersion).toBe(8);

      const update3 = batchUpdatedEvent!.updates.find((u) => u.recordId === record3.id);
      expect(update3?.oldVersion).toBe(12);
      expect(update3?.newVersion).toBe(13);
    });

    it('publishes update change values normalized to target field types', async () => {
      const { table, tableId, textFieldId, numberFieldId } = buildTable();
      const viewId = table.views()[0]!.id();

      const existingVersion = 9;
      const recordId = `rec${'z'.repeat(16)}`;

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: recordId,
          fields: {
            [textFieldId.toString()]: 'Old Text',
            [numberFieldId.toString()]: 1,
          },
          version: existingVersion,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [1, 0],
        ],
        content: [[123, '456']],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      expect(result.isOk()).toBe(true);

      const batchUpdatedEvent = eventBus.published.find(
        (event) => event instanceof RecordsBatchUpdated
      ) as RecordsBatchUpdated | undefined;

      expect(batchUpdatedEvent).toBeDefined();
      expect(batchUpdatedEvent!.updates).toHaveLength(1);

      const update = batchUpdatedEvent!.updates[0]!;
      const textChange = update.changes.find((change) => change.fieldId === textFieldId.toString());
      const numberChange = update.changes.find(
        (change) => change.fieldId === numberFieldId.toString()
      );

      expect(textChange).toBeDefined();
      expect(typeof textChange!.newValue).toBe('string');
      expect(textChange!.newValue).toBe('123');

      expect(numberChange).toBeDefined();
      expect(typeof numberChange!.newValue).toBe('number');
      expect(numberChange!.newValue).toBe(456);
    });

    it('publishes field side-effect events before RecordsBatchUpdated when typecast adds options', async () => {
      const { table, tableId, textFieldId, singleSelectFieldId } = buildTableWithSingleSelect();
      const viewId = table.views()[0]!.id();
      const recordId = `rec${'k'.repeat(16)}`;

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: recordId,
          fields: {
            [textFieldId.toString()]: 'Old Title',
            [singleSelectFieldId.toString()]: 'Open',
          },
          version: 4,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [1, 0],
          [1, 0],
        ],
        content: [['In Progress']],
        typecast: true,
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      expect(result.isOk()).toBe(true);

      expect(eventBus.published).toHaveLength(2);
      expect(eventBus.published[0]).toBeInstanceOf(FieldOptionsAdded);
      expect(eventBus.published[1]).toBeInstanceOf(RecordsBatchUpdated);
    });
  });

  describe('additional behavior', () => {
    it('uses batched resolution for typecast paste with multiple rows', async () => {
      const { table, tableId } = buildTableWithUser();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const resolver = new CountingRecordMutationSpecResolverService();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        new FakeTableRecordQueryRepository(),
        resolver as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const command = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [1, 2],
        ],
        content: [
          ['A', { id: 'usr-1' }],
          ['B', { id: 'usr-1' }],
          ['C', { id: 'usr-1' }],
        ],
        typecast: true,
      });

      const result = await handler.handle(createContext(), command._unsafeUnwrap());
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().createdCount).toBe(3);
      expect(resolver.resolveAndReplaceManyCalls).toBe(1);
      expect(resolver.resolveAndReplaceCalls).toBe(0);
      expect(resolver.resolvedBatchSizes).toEqual([3]);
    });

    it('uses batched resolution for typecast update paste with multiple rows', async () => {
      const { table, tableId, textFieldId, userFieldId } = buildTableWithUser();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: `rec${'a'.repeat(16)}`,
          fields: {
            [textFieldId.toString()]: 'old-a',
            [userFieldId.toString()]: { id: 'usr-old' },
          },
          version: 1,
        },
        {
          id: `rec${'b'.repeat(16)}`,
          fields: {
            [textFieldId.toString()]: 'old-b',
            [userFieldId.toString()]: { id: 'usr-old' },
          },
          version: 2,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const resolver = new CountingRecordMutationSpecResolverService();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        resolver as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const command = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [1, 1],
        ],
        content: [
          ['A', { id: 'usr-1' }],
          ['B', { id: 'usr-1' }],
        ],
        typecast: true,
      });

      const result = await handler.handle(createContext(), command._unsafeUnwrap());
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().updatedCount).toBe(2);
      expect(resolver.resolveAndReplaceManyCalls).toBe(1);
      expect(resolver.resolveAndReplaceCalls).toBe(0);
      expect(resolver.resolvedBatchSizes).toEqual([2]);
    });

    it('streams large typecast create paste without accumulating a single create batch', async () => {
      const { table, tableId } = buildTableWithUser();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const resolver = new CountingRecordMutationSpecResolverService();
      const recordRepository = new FakeTableRecordRepository();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        new FakeTableRecordQueryRepository(),
        resolver as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const content = Array.from({ length: 501 }, (_, index) => [
        `Title ${index}`,
        { id: 'usr-1' },
      ]);
      const command = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [1, 500],
        ],
        content,
        typecast: true,
      });

      const result = await handler.handle(createContext(), command._unsafeUnwrap());
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().createdCount).toBe(501);
      expect(resolver.resolveAndReplaceManyCalls).toBe(2);
      expect(resolver.resolvedBatchSizes).toEqual([500, 1]);
      expect(recordRepository.insertCalls).toBe(1);
      expect(recordRepository.inserted).toHaveLength(501);
    });

    it('streams large typecast update paste through a single repository update stream', async () => {
      const { table, tableId, textFieldId, userFieldId } = buildTableWithUser();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = Array.from({ length: 501 }, (_, index) => ({
        id: `rec${String(index).padStart(16, '0')}`,
        fields: {
          [textFieldId.toString()]: `old-${index}`,
          [userFieldId.toString()]: { id: 'usr-old' },
        },
        version: index + 1,
      }));

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const resolver = new CountingRecordMutationSpecResolverService();
      const recordRepository = new FakeTableRecordRepository();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        recordQueryRepository,
        resolver as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const content = Array.from({ length: 501 }, (_, index) => [
        `Title ${index}`,
        { id: 'usr-1' },
      ]);
      const command = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [1, 500],
        ],
        content,
        typecast: true,
      });

      const result = await handler.handle(createContext(), command._unsafeUnwrap());
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().updatedCount).toBe(501);
      expect(resolver.resolveAndReplaceManyCalls).toBe(2);
      expect(resolver.resolvedBatchSizes).toEqual([500, 1]);
      expect(recordRepository.updateCalls).toBe(1);
      expect(recordRepository.updated).toHaveLength(501);
    });

    it('returns zero counts when content is empty', async () => {
      const { table, tableId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        new FakeTableRecordQueryRepository(),
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        new FakeEventBus(),
        noopUndoRedoService,
        new FakeUnitOfWork()
      );

      const command = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [],
      });

      const result = await handler.handle(createContext(), command._unsafeUnwrap());
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        updatedCount: 0,
        createdCount: 0,
        createdRecordIds: [],
      });
    });

    it('skips updates when updateFilter excludes records', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: `rec${'x'.repeat(16)}`,
          fields: { [textFieldId.toString()]: 'Old Title' },
          version: 1,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const command = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['New Title']],
        updateFilter: {
          fieldId: textFieldId.toString(),
          operator: 'is',
          value: 'Different',
        },
      });

      const result = await handler.handle(createContext(), command._unsafeUnwrap());
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().updatedCount).toBe(0);
      expect(result._unsafeUnwrap().createdCount).toBe(0);
      expect(eventBus.published).toHaveLength(0);
    });

    it('expands columns when paste exceeds field count', async () => {
      const { table, tableId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const command = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [2, 0],
        ],
        content: [['A', 'B', 'C']],
      });

      const result = await handler.handle(createContext(), command._unsafeUnwrap());
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().createdCount).toBe(1);
      expect(tableRepository.updated).toHaveLength(1);
      expect(tableRepository.updated[0]?.getFields()).toHaveLength(3);
    });
  });

  it('skips plugins that do not support paste', async () => {
    const { table, tableId } = buildTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [];

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const { plugin, calls } = createTrackedRecordWritePlugin([RecordWriteOperationKind.createOne]);

    const handler = new PasteHandler(
      tableQueryService,
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      new FakeFieldCreationSideEffectService() as never,
      new FakeForeignTableLoaderService() as never,
      new FakeTableRecordRepository(),
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      createRecordWritePluginRunner([plugin]),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const command = PasteCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [['A']],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    result._unsafeUnwrap();

    expectRecordWritePluginToBeSkipped(calls, RecordWriteOperationKind.paste);
  });

  it('rejects when a plugin blocks paste', async () => {
    const { table, tableId } = buildTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const blockingError = domainError.forbidden({
      code: 'plugin.paste_blocked',
      message: 'blocked paste',
    });

    const handler = new PasteHandler(
      tableQueryService,
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      new FakeFieldCreationSideEffectService() as never,
      new FakeForeignTableLoaderService() as never,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      createRecordWritePluginRunner([
        {
          name: 'paste-blocker',
          supports: (operation) => operation === RecordWriteOperationKind.paste,
          guard: async () => err(blockingError),
        },
      ]),
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const command = PasteCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [['A']],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('plugin.paste_blocked');
    expect(recordRepository.inserted).toHaveLength(0);
    expect(recordRepository.updated).toHaveLength(0);
    expect(recordRepository.updateCalls).toBe(0);
    expect(tableRepository.updated).toHaveLength(0);
    expect(eventBus.published).toHaveLength(0);
  });
});
