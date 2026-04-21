import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { PasteLinkAutoResolveService } from '../application/services/PasteLinkAutoResolveService';
import type { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import type { RecordWriteUndoRedoPlanService } from '../application/services/RecordWriteUndoRedoPlanService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoStackService } from '../application/services/UndoRedoStackService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldOptionsAdded } from '../domain/table/events/FieldOptionsAdded';
import { isRecordsBatchUpdatedEvent } from '../domain/table/events/RecordsBatchUpdated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { FieldType } from '../domain/table/fields/FieldType';
import { CellValueMultiplicity } from '../domain/table/fields/types/CellValueMultiplicity';
import { CellValueType } from '../domain/table/fields/types/CellValueType';
import { FormulaExpression } from '../domain/table/fields/types/FormulaExpression';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import type { UserField } from '../domain/table/fields/types/UserField';
import type { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type {
  ITableRecordRepository,
  RecordMutationResult,
  BatchRecordMutationResult,
  InsertManyStreamBatchInput,
  InsertManyStreamOptions,
  UpdateManyStreamBatchInput,
  UpdateManyStreamResult,
} from '../ports/TableRecordRepository';
import { isInsertManyStreamBatch, isUpdateManyStreamBatch } from '../ports/TableRecordRepository';
import type {
  ITableRepository,
  TableFindOptions,
  TableUpdatePersistResult,
} from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import {
  createUndoRedoCommand,
  flattenUndoRedoCommands,
  type UndoRedoApplyFieldSnapshotCommandData,
  type UndoRedoDeleteFieldCommandData,
} from '../ports/UndoRedoStore';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { PasteCommand } from './PasteCommand';
import { PasteHandler, PasteStreamApplicationService } from './PasteHandler';
import { PasteStreamCommand } from './PasteStreamCommand';
import {
  createRecordWritePluginRunner,
  createTrackedRecordWritePlugin,
} from './recordWritePluginRunnerTestUtils';
import { createNoopUndoRedoStackService } from './undoRedoStackServiceTestUtils';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const noopUndoRedoService = createNoopUndoRedoStackService();

const noopRecordWriteUndoRedoPlanService = {
  captureCreatedFields: async () => ok({ undoCommands: [], redoCommands: [] }),
  captureSelectOptionSideEffects: async () => ok({ undoCommands: [], redoCommands: [] }),
} as unknown as RecordWriteUndoRedoPlanService;

const noopPasteLinkAutoResolveService = {
  resolve: async () =>
    ok({
      resolvedValues: new Map(),
      tableEvents: [],
      undoCommands: [],
      redoCommands: [],
      afterCommitHandlers: [],
    }),
} as unknown as PasteLinkAutoResolveService;

class TrackingUndoRedoService {
  recordEntryCalls = 0;
  entries: Array<{
    groupId?: string;
    undoCommand: unknown;
    redoCommand: unknown;
  }> = [];
  latestEntry:
    | {
        groupId?: string;
        undoCommand: unknown;
        redoCommand: unknown;
      }
    | undefined;

  async appendEntry(
    _context: IExecutionContext,
    _tableId: TableId,
    entry: { groupId?: string; undoCommand: unknown; redoCommand: unknown }
  ) {
    this.recordEntryCalls += 1;
    this.latestEntry = entry;
    this.entries.push(entry);
    return ok(undefined);
  }
}

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

const buildTableWithFormula = () => {
  const baseId = BaseId.create(`bse${'f'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'g'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Paste Formula Test')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
  const formulaFieldId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();

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
    .formula()
    .withId(formulaFieldId)
    .withName(FieldName.create('Computed')._unsafeUnwrap())
    .withExpression(FormulaExpression.create('1')._unsafeUnwrap())
    .withResultType({
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    })
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    baseId,
    tableId,
    textFieldId,
    formulaFieldId,
  };
};

const buildTableWithMissingForeignLink = () => {
  const baseId = BaseId.create(`bse${'l'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'l'.repeat(16)}`)._unsafeUnwrap();
  const missingForeignTableId = TableId.create(`tbl${'m'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Paste Link Error Test')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
  const linkFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
  const linkConfig = LinkFieldConfig.create({
    baseId: baseId.toString(),
    relationship: 'manyMany',
    foreignTableId: missingForeignTableId.toString(),
    lookupFieldId: textFieldId.toString(),
    isOneWay: true,
  })._unsafeUnwrap();

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
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Related')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    tableId,
    linkFieldId,
  };
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  updated: Table[] = [];
  onUpdateOne?: (table: Table) => void;

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
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: Pick<TableFindOptions, 'state'>
  ): Promise<Result<Table, DomainError>> {
    const match = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!match) return err(domainError.notFound({ message: 'Table not found' }));
    return ok(match);
  }

  async find(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    __?: TableFindOptions
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _: IExecutionContext,
    table: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<TableUpdatePersistResult | void, DomainError>> {
    const index = this.tables.findIndex((entry) => entry.id().equals(table.id()));
    if (index >= 0) {
      this.tables[index] = table;
    }
    this.updated.push(table);
    this.onUpdateOne?.(table);
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
  insertStreamContexts: IExecutionContext[] = [];
  updateStreamContexts: IExecutionContext[] = [];
  onInsertManyStream?: (table: Table) => void;
  onUpdateManyStream?: (table: Table) => void;
  onUpdatedRecord?: (record: TableRecord) => void;
  updateManyStreamUpdatedRecordIds: Set<string> | undefined = undefined;
  updateManyStreamVersions = new Map<string, number>();

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

  async insertManyStream(
    context: IExecutionContext,
    table: Table,
    batches: Iterable<InsertManyStreamBatchInput> | AsyncIterable<InsertManyStreamBatchInput>,
    options?: InsertManyStreamOptions
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    this.insertCalls += 1;
    this.insertStreamContexts.push(context);
    this.onInsertManyStream?.(table);
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
    context: IExecutionContext,
    table: Table,
    batches:
      | Iterable<Result<UpdateManyStreamBatchInput, DomainError>>
      | AsyncIterable<Result<UpdateManyStreamBatchInput, DomainError>>
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    this.updateCalls += 1;
    this.updateStreamContexts.push(context);
    this.onUpdateManyStream?.(table);
    let totalUpdated = 0;
    const updatedRecords: NonNullable<UpdateManyStreamResult['updatedRecords']> = [];
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
          const recordId = update.record.id();
          const returnedRecord = this.toReturnedUpdatedRecord(update.record);
          if (
            this.updateManyStreamUpdatedRecordIds &&
            !this.updateManyStreamUpdatedRecordIds.has(recordId.toString())
          ) {
            continue;
          }
          this.updated.push(update);
          this.onUpdatedRecord?.(update.record);
          updatedRecords.push(returnedRecord);
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
          const recordId = update.record.id();
          const returnedRecord = this.toReturnedUpdatedRecord(update.record);
          if (
            this.updateManyStreamUpdatedRecordIds &&
            !this.updateManyStreamUpdatedRecordIds.has(recordId.toString())
          ) {
            continue;
          }
          this.updated.push(update);
          this.onUpdatedRecord?.(update.record);
          updatedRecords.push(returnedRecord);
          totalUpdated += 1;
        }
      }
    }
    return ok({
      totalUpdated,
      updatedRecords,
    });
  }

  private toReturnedUpdatedRecord(
    record: TableRecord
  ): UpdateManyStreamResult['updatedRecords'][number] {
    const recordId = record.id();
    const recordIdText = recordId.toString();
    const storedRecord = this.queryRepository?.records.find((item) => item.id === recordIdText);
    const configuredNewVersion = this.updateManyStreamVersions.get(recordIdText);
    const oldVersion =
      storedRecord?.version ?? (configuredNewVersion !== undefined ? configuredNewVersion - 1 : 0);
    const newVersion = configuredNewVersion ?? (storedRecord ? storedRecord.version + 1 : 1);
    const oldFieldValues: Record<string, unknown> = {};

    if (storedRecord) {
      for (const entry of record.fields().entries()) {
        const fieldId = entry.fieldId.toString();
        if (Object.prototype.hasOwnProperty.call(storedRecord.fields, fieldId)) {
          oldFieldValues[fieldId] = storedRecord.fields[fieldId];
        }
      }
    }

    return { recordId, oldVersion, newVersion, oldFieldValues };
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

class OffsetPagingFilteredTableRecordQueryRepository extends FakeTableRecordQueryRepository {
  constructor(
    records: TableRecordReadModel[],
    private readonly filterFieldId: string,
    private readonly pageSize = 2
  ) {
    super();
    this.records = records;
  }

  private visibleRecords(): TableRecordReadModel[] {
    return this.records.filter((record) => !record.fields[this.filterFieldId]);
  }

  applyUpdatedRecord(record: TableRecord) {
    const readModel = this.records.find((entry) => entry.id === record.id().toString());
    if (!readModel) return;

    readModel.version += 1;
    for (const entry of record.fields().entries()) {
      readModel.fields[entry.fieldId.toString()] = entry.value.toValue();
    }
  }

  override async find(): Promise<
    Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>
  > {
    const visibleRecords = this.visibleRecords();
    return ok({ records: visibleRecords, total: visibleRecords.length });
  }

  override findStream(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: Parameters<ITableRecordQueryRepository['findStream']>[3]
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    const startOffset =
      options?.pagination && 'offset' in options.pagination ? options.pagination.offset : 0;
    const maxLimit = options?.pagination?.limit ?? Number.POSITIVE_INFINITY;
    const pageSize = this.pageSize;

    return {
      [Symbol.asyncIterator]: async function* (
        this: OffsetPagingFilteredTableRecordQueryRepository
      ) {
        let yieldedCount = 0;

        while (yieldedCount < maxLimit) {
          const limit = Math.min(pageSize, maxLimit - yieldedCount);
          const offset = startOffset + yieldedCount;
          const page = this.visibleRecords().slice(offset, offset + limit);
          if (page.length === 0) break;

          for (const record of page) {
            yield ok(record);
            yieldedCount += 1;
          }

          if (page.length < limit) break;
        }
      }.bind(this),
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
        new FakeTableRecordRepository(recordQueryRepository),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
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
      const batchUpdatedEvent = eventBus.published.find(isRecordsBatchUpdatedEvent);

      expect(batchUpdatedEvent).toBeDefined();
      expect(batchUpdatedEvent!.updates).toHaveLength(1);

      const update = batchUpdatedEvent!.updates[0]!;
      expect(update.recordId).toBe(recordId);
      expect(update.oldVersion).toBe(existingVersion);
      expect(update.newVersion).toBe(existingVersion + 1);
    });

    it('does not publish RecordsBatchUpdated when storage skips an unchanged paste update', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const viewId = table.views()[0]!.id();
      const recordId = `rec${'s'.repeat(16)}`;

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordRepository = new FakeTableRecordRepository();
      recordRepository.updateManyStreamUpdatedRecordIds = new Set();
      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: recordId,
          fields: { [textFieldId.toString()]: 'Same Title' },
          version: 5,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const undoRedoService = new TrackingUndoRedoService();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        undoRedoService as unknown as UndoRedoService,
        unitOfWork
      );

      const commandResult = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['Same Title']],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());

      expect(result._unsafeUnwrap().updatedCount).toBe(0);
      expect(recordRepository.updateCalls).toBe(1);
      expect(eventBus.published.some(isRecordsBatchUpdatedEvent)).toBe(false);
      expect(undoRedoService.recordEntryCalls).toBe(0);
    });

    it('keeps persisted update count separate from publishable update events', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const viewId = table.views()[0]!.id();
      const recordId = `rec${'c'.repeat(16)}`;

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordRepository = new FakeTableRecordRepository();
      recordRepository.updateManyStreamUpdatedRecordIds = new Set([recordId]);
      recordRepository.updateManyStreamVersions.set(recordId, 6);
      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: recordId,
          fields: { [textFieldId.toString()]: 'Same Title' },
          version: 5,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const undoRedoService = new TrackingUndoRedoService();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        undoRedoService as unknown as UndoRedoService,
        unitOfWork
      );

      const commandResult = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['Same Title']],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());

      expect(result._unsafeUnwrap().updatedCount).toBe(1);
      expect(recordRepository.updateCalls).toBe(1);
      expect(recordRepository.updated).toHaveLength(1);
      expect(eventBus.published.some(isRecordsBatchUpdatedEvent)).toBe(false);
      expect(undoRedoService.recordEntryCalls).toBe(0);
    });

    it('omits unchanged pasted fields from update event changes', async () => {
      const { table, tableId, textFieldId, numberFieldId } = buildTable();
      const viewId = table.views()[0]!.id();
      const recordId = `rec${'m'.repeat(16)}`;

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: recordId,
          fields: {
            [textFieldId.toString()]: 'Same Title',
            [numberFieldId.toString()]: 1,
          },
          version: 8,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(recordQueryRepository),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
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
        content: [['Same Title', 2]],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());

      expect(result._unsafeUnwrap().updatedCount).toBe(1);
      const batchUpdatedEvent = eventBus.published.find(isRecordsBatchUpdatedEvent);
      expect(batchUpdatedEvent?.updates).toHaveLength(1);
      expect(batchUpdatedEvent?.updates[0]?.changes).toEqual([
        {
          fieldId: numberFieldId.toString(),
          oldValue: 1,
          newValue: 2,
        },
      ]);
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
        new FakeTableRecordRepository(recordQueryRepository),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
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

      const batchUpdatedEvent = eventBus.published.find(isRecordsBatchUpdatedEvent);

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
        noopPasteLinkAutoResolveService,
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

      const batchUpdatedEvent = eventBus.published.find(isRecordsBatchUpdatedEvent);

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
        noopPasteLinkAutoResolveService,
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
      expect(isRecordsBatchUpdatedEvent(eventBus.published[1]!)).toBe(true);
    });
  });

  describe('additional behavior', () => {
    it('returns early for empty paste content without mutating records', async () => {
      const { table, tableId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const recordRepository = new FakeTableRecordRepository();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        new FakeTableRecordQueryRepository(),
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
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
        content: [],
      })._unsafeUnwrap();

      const result = await handler.handle(createContext(), command);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        updatedCount: 0,
        createdCount: 0,
        createdRecordIds: [],
      });
      expect(recordRepository.insertCalls).toBe(0);
      expect(recordRepository.updateCalls).toBe(0);
      expect(eventBus.published).toHaveLength(0);
    });

    it('skips paste when selected columns are all computed fields', async () => {
      const { table, tableId, formulaFieldId } = buildTableWithFormula();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const recordRepository = new FakeTableRecordRepository();
      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: `rec${'j'.repeat(16)}`,
          fields: { [formulaFieldId.toString()]: 1 },
          version: 1,
        },
      ];

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
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
          [1, 0],
          [1, 0],
        ],
        content: [['123']],
      })._unsafeUnwrap();

      const result = await handler.handle(createContext(), command);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        updatedCount: 0,
        createdCount: 0,
        createdRecordIds: [],
      });
      expect(recordRepository.insertCalls).toBe(0);
      expect(recordRepository.updateCalls).toBe(0);
      expect(eventBus.published).toHaveLength(0);
    });

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
        noopPasteLinkAutoResolveService,
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
        noopPasteLinkAutoResolveService,
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
        noopPasteLinkAutoResolveService,
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
        noopPasteLinkAutoResolveService,
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
        noopPasteLinkAutoResolveService,
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
        noopPasteLinkAutoResolveService,
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
        noopPasteLinkAutoResolveService,
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

    it('defers column-expansion persistence until the execution transaction', async () => {
      const { table, tableId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordRepository = new FakeTableRecordRepository();
      const executionOrder: string[] = [];
      let beforePersistFieldCount: number | undefined;
      let insertedFieldCount: number | undefined;
      tableRepository.onUpdateOne = () => executionOrder.push('ddl');
      recordRepository.onInsertManyStream = (table) => {
        insertedFieldCount = table.getFields().length;
        executionOrder.push('insert');
      };

      const plugin = {
        name: 'paste-expansion-order',
        supports: (operation: RecordWriteOperationKind) =>
          operation === RecordWriteOperationKind.paste,
        prepare: async () => {
          executionOrder.push(`prepare:${tableRepository.updated.length}`);
          return ok(undefined);
        },
        guard: async () => ok(undefined),
        beforePersist: async (context: { table: Table }) => {
          beforePersistFieldCount = context.table.getFields().length;
          executionOrder.push(`beforePersist:${tableRepository.updated.length}`);
          return ok(undefined);
        },
        afterCommit: async () => ok(undefined),
      };

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        new FakeTableRecordQueryRepository(),
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner([plugin]),
        new FakeEventBus(),
        noopUndoRedoService,
        new FakeUnitOfWork()
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
      expect(executionOrder).toEqual([
        'prepare:0',
        'prepare:0',
        'beforePersist:0',
        'ddl',
        'insert',
      ]);
      expect(beforePersistFieldCount).toBe(2);
      expect(insertedFieldCount).toBe(3);
    });

    it('records undo and redo commands for auto-created paste columns', async () => {
      const { table, tableId, baseId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const undoRedoService = new TrackingUndoRedoService();
      const capturedCreatedFieldIds: string[] = [];

      const recordWriteUndoRedoPlanService = {
        captureCreatedFields: async (
          _context: IExecutionContext,
          updatedTable: Table,
          fieldIds: ReadonlyArray<FieldId>
        ) => {
          capturedCreatedFieldIds.push(...fieldIds.map((fieldId) => fieldId.toString()));
          return ok({
            undoCommands: [...fieldIds].reverse().map((fieldId) =>
              createUndoRedoCommand('DeleteField', {
                baseId: updatedTable.baseId().toString(),
                tableId: updatedTable.id().toString(),
                fieldId: fieldId.toString(),
              })
            ),
            redoCommands: fieldIds.map((fieldId) =>
              createUndoRedoCommand('ApplyFieldSnapshot', {
                baseId: updatedTable.baseId().toString(),
                tableId: updatedTable.id().toString(),
                snapshot: {
                  field: {
                    id: fieldId.toString(),
                    name: `Snapshot ${fieldId.toString()}`,
                    type: 'singleLineText',
                  },
                  views: [],
                },
              })
            ),
          });
        },
        captureSelectOptionSideEffects: async () => ok({ undoCommands: [], redoCommands: [] }),
      } as unknown as RecordWriteUndoRedoPlanService;

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        new FakeTableRecordQueryRepository(),
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
        new RecordWriteSideEffectService(),
        recordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        new FakeEventBus(),
        undoRedoService as unknown as UndoRedoStackService,
        new FakeUnitOfWork()
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

      const result = await handler.handle(
        { ...createContext(), windowId: 'win-paste-expand' },
        command._unsafeUnwrap()
      );
      expect(result.isOk()).toBe(true);
      expect(capturedCreatedFieldIds).toHaveLength(1);
      expect(undoRedoService.recordEntryCalls).toBe(1);

      const undoLeaves = flattenUndoRedoCommands(
        undoRedoService.latestEntry?.undoCommand as never
      ).filter((leaf): leaf is UndoRedoDeleteFieldCommandData => leaf.type === 'DeleteField');
      expect(undoLeaves.map((leaf) => leaf.payload)).toEqual([
        {
          baseId: baseId.toString(),
          tableId: tableId.toString(),
          fieldId: capturedCreatedFieldIds[0],
        },
      ]);

      const redoLeaves = flattenUndoRedoCommands(
        undoRedoService.latestEntry?.redoCommand as never
      ).filter(
        (leaf): leaf is UndoRedoApplyFieldSnapshotCommandData => leaf.type === 'ApplyFieldSnapshot'
      );
      expect(redoLeaves.map((leaf) => leaf.payload.snapshot.field.id)).toEqual(
        capturedCreatedFieldIds
      );
    });

    it('maps lookup source field metadata when auto-expanding pasted columns', async () => {
      const { table, tableId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        new FakeTableRecordQueryRepository(),
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
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
        content: [['A', 1, 'Open']],
        sourceFields: [
          { name: 'Title', type: 'singleLineText' },
          { name: 'Amount', type: 'number' },
          {
            name: 'Lookup Assignee',
            type: 'user',
            isLookup: true,
            isMultipleCellValue: true,
            options: { shouldNotify: false },
          },
        ],
      })._unsafeUnwrap();

      const result = await handler.handle(createContext(), command);

      expect(result.isOk()).toBe(true);
      expect(tableRepository.updated).toHaveLength(1);
      const expandedField = tableRepository.updated[0]
        ?.getFields()
        .find((field) => field.name().toString() === 'Lookup Assignee');
      expect(expandedField).toBeDefined();
      expect(expandedField?.type().equals(FieldType.user())).toBe(true);
      expect((expandedField as UserField | undefined)?.multiplicity().toBoolean()).toBe(true);
    });

    it('returns an error when typecast update paste cannot load linked record titles', async () => {
      const { table, tableId, linkFieldId } = buildTableWithMissingForeignLink();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: `rec${'u'.repeat(16)}`,
          fields: { [linkFieldId.toString()]: null },
          version: 1,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const recordRepository = new FakeTableRecordRepository();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
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
          [1, 0],
          [1, 0],
        ],
        content: [[`rec${'z'.repeat(16)}`]],
        typecast: true,
      })._unsafeUnwrap();

      const result = await handler.handle(createContext(), command);

      expect(result.isErr()).toBe(true);
      expect(recordRepository.updateCalls).toBe(1);
      expect(recordRepository.updated).toHaveLength(0);
      expect(eventBus.published).toHaveLength(0);
    });

    it('returns an error when typecast create paste cannot load linked record titles', async () => {
      const { table, tableId } = buildTableWithMissingForeignLink();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const recordRepository = new FakeTableRecordRepository();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        new FakeTableRecordQueryRepository(),
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
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
          [1, 0],
          [1, 0],
        ],
        content: [[`rec${'y'.repeat(16)}`]],
        typecast: true,
      })._unsafeUnwrap();

      const result = await handler.handle(createContext(), command);

      expect(result.isErr()).toBe(true);
      expect(recordRepository.insertCalls).toBe(1);
      expect(recordRepository.inserted).toHaveLength(0);
      expect(eventBus.published).toHaveLength(0);
    });
  });

  it('trims paste update and create fields from plugin scope independently', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [
      {
        id: `rec${'p'.repeat(16)}`,
        version: 1,
        fields: {
          [textFieldId.toString()]: 'old-title',
          [numberFieldId.toString()]: 1,
        },
      },
    ];

    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new PasteHandler(
      tableQueryService,
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      new FakeFieldCreationSideEffectService() as never,
      new FakeForeignTableLoaderService() as never,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      noopPasteLinkAutoResolveService,
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      createRecordWritePluginRunner([
        {
          name: 'paste-scope-fields',
          supports: (operation) => operation === RecordWriteOperationKind.paste,
          scope: async () =>
            ok({
              updateFieldIds: new Set([textFieldId.toString()]),
              createFieldIds: new Set([numberFieldId.toString()]),
            }),
          guard: async () => ok(undefined),
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
        [1, 1],
      ],
      content: [
        ['new-title', 99],
        ['created-title', 123],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      updatedCount: 1,
      createdCount: 1,
    });
    expect(recordRepository.updated).toHaveLength(1);
    expect(recordRepository.inserted).toHaveLength(1);
    expect(recordRepository.updated[0]?.record.fields().get(textFieldId)?.toValue()).toBe(
      'new-title'
    );
    expect(recordRepository.updated[0]?.record.fields().get(numberFieldId)).toBeUndefined();
    expect(recordRepository.inserted[0]?.fields().get(textFieldId)).toBeUndefined();
    expect(recordRepository.inserted[0]?.fields().get(numberFieldId)?.toValue()).toBe(123);
  });

  it('trims paste update fields per record when plugin field scope varies by record', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [
      {
        id: `rec${'a'.repeat(16)}`,
        version: 1,
        fields: {
          [textFieldId.toString()]: 'row-1',
          [numberFieldId.toString()]: 1,
        },
      },
      {
        id: `rec${'b'.repeat(16)}`,
        version: 1,
        fields: {
          [textFieldId.toString()]: 'row-2',
          [numberFieldId.toString()]: 2,
        },
      },
    ];

    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new PasteHandler(
      tableQueryService,
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      new FakeFieldCreationSideEffectService() as never,
      new FakeForeignTableLoaderService() as never,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      noopPasteLinkAutoResolveService,
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      createRecordWritePluginRunner([
        {
          name: 'paste-scope-fields-per-record',
          supports: (operation) => operation === RecordWriteOperationKind.paste,
          scope: async () =>
            ok({
              updateFieldIds: new Set([textFieldId.toString(), numberFieldId.toString()]),
              resolveUpdateFieldIdsForRecord: (record) =>
                record.fields().get(textFieldId)?.toValue() === 'row-1'
                  ? new Set([textFieldId.toString()])
                  : new Set([numberFieldId.toString()]),
            }),
          guard: async () => ok(undefined),
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
        [1, 1],
      ],
      content: [
        ['updated-row-1', 11],
        ['updated-row-2', 22],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      updatedCount: 2,
      createdCount: 0,
    });
    expect(recordRepository.updated).toHaveLength(2);
    expect(recordRepository.updated[0]?.record.fields().get(textFieldId)?.toValue()).toBe(
      'updated-row-1'
    );
    expect(recordRepository.updated[0]?.record.fields().get(numberFieldId)).toBeUndefined();
    expect(recordRepository.updated[1]?.record.fields().get(textFieldId)).toBeUndefined();
    expect(recordRepository.updated[1]?.record.fields().get(numberFieldId)?.toValue()).toBe(22);
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
      noopPasteLinkAutoResolveService,
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

    expect(calls.supports).toEqual([
      RecordWriteOperationKind.paste,
      RecordWriteOperationKind.paste,
    ]);
    expect(calls.prepare).toHaveLength(0);
    expect(calls.guard).toHaveLength(0);
    expect(calls.beforePersist).toHaveLength(0);
    expect(calls.afterCommit).toHaveLength(0);
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
      noopPasteLinkAutoResolveService,
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

  it('passes operation batch mutation metadata into regular paste persistence and events', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [
      {
        id: `rec${'p'.repeat(16)}`,
        fields: { [textFieldId.toString()]: 'Old 1' },
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
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      noopPasteLinkAutoResolveService,
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
        [0, 1],
      ],
      content: [['Updated 1'], ['Created 2']],
    })._unsafeUnwrap();

    const result = await handler.handle({ ...createContext(), requestId: 'req-paste' }, command);
    result._unsafeUnwrap();

    expect(recordRepository.updateStreamContexts[0]?.batchMutation).toEqual({
      operationId: 'req-paste',
      groupId: 'req-paste',
      totalRecordCount: 2,
      totalChunkCount: 1,
      chunkIndex: 0,
      scope: 'operation',
    });
    expect(recordRepository.insertStreamContexts[0]?.batchMutation).toEqual({
      operationId: 'req-paste',
      groupId: 'req-paste',
      totalRecordCount: 2,
      totalChunkCount: 1,
      chunkIndex: 0,
      scope: 'operation',
    });

    const batchUpdatedEvent = eventBus.published.find(isRecordsBatchUpdatedEvent);
    expect(batchUpdatedEvent?.orchestration).toEqual({
      operationId: 'req-paste',
      groupId: 'req-paste',
      totalRecordCount: 2,
      totalChunkCount: 1,
      chunkIndex: 0,
      scope: 'operation',
    });
  });

  describe('PasteStreamApplicationService', () => {
    it('streams chunk progress and publishes grouped batch events', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: `rec${'p'.repeat(16)}`,
          fields: { [textFieldId.toString()]: 'Old 1' },
          version: 1,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();
      const trackingUndoRedoService = new TrackingUndoRedoService();
      const recordRepository = new FakeTableRecordRepository();

      const handler = new PasteStreamApplicationService(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        trackingUndoRedoService as unknown as UndoRedoStackService,
        unitOfWork
      );

      const command = PasteStreamCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['Updated 1'], ['Created 2'], ['Created 3']],
        batchSize: 1,
      })._unsafeUnwrap();

      const events = [];
      for await (const event of handler.createStream(createContext(), command)) {
        events.push(event);
      }

      expect(events).toMatchObject([
        {
          id: 'progress',
          phase: 'preparing',
          batchIndex: -1,
          totalCount: 0,
          processedCount: 0,
          updatedCount: 0,
          createdCount: 0,
          batchProcessedCount: 0,
        },
        {
          id: 'progress',
          phase: 'preparing',
          batchIndex: -1,
          totalCount: 3,
          processedCount: 0,
          updatedCount: 0,
          createdCount: 0,
          batchProcessedCount: 0,
        },
        {
          id: 'progress',
          phase: 'pasting',
          batchIndex: 0,
          totalCount: 3,
          processedCount: 1,
          updatedCount: 1,
          createdCount: 0,
          batchProcessedCount: 1,
        },
        {
          id: 'progress',
          phase: 'pasting',
          batchIndex: 1,
          totalCount: 3,
          processedCount: 2,
          updatedCount: 1,
          createdCount: 1,
          batchProcessedCount: 1,
        },
        {
          id: 'progress',
          phase: 'pasting',
          batchIndex: 2,
          totalCount: 3,
          processedCount: 3,
          updatedCount: 1,
          createdCount: 2,
          batchProcessedCount: 1,
        },
        {
          id: 'done',
          totalCount: 3,
          processedCount: 3,
          updatedCount: 1,
          createdCount: 2,
          data: {
            updatedCount: 1,
            createdCount: 2,
          },
        },
      ]);

      const batchUpdatedEvents = eventBus.published.filter(isRecordsBatchUpdatedEvent);
      expect(batchUpdatedEvents).toHaveLength(1);
      expect(batchUpdatedEvents[0]?.orchestration).toMatchObject({
        totalRecordCount: 3,
        totalChunkCount: 3,
        chunkIndex: 0,
        scope: 'chunk',
      });

      const batchCreatedEvents = eventBus.published.filter(
        (event) => event.constructor.name === 'RecordsBatchCreated'
      ) as Array<{
        orchestration?: {
          groupId?: string;
          chunkIndex?: number;
          totalChunkCount?: number;
          scope?: string;
        };
      }>;
      expect(batchCreatedEvents).toHaveLength(2);
      expect(batchCreatedEvents[0]?.orchestration).toMatchObject({
        chunkIndex: 1,
        totalChunkCount: 3,
        scope: 'chunk',
      });
      expect(batchCreatedEvents[1]?.orchestration).toMatchObject({
        chunkIndex: 2,
        totalChunkCount: 3,
        scope: 'chunk',
      });

      expect(recordRepository.updateStreamContexts[0]?.batchMutation).toEqual({
        operationId: expect.any(String),
        groupId: expect.any(String),
        totalRecordCount: 3,
        totalChunkCount: 3,
        chunkIndex: 0,
        scope: 'chunk',
      });
      expect(recordRepository.insertStreamContexts[0]?.batchMutation).toEqual({
        operationId: expect.any(String),
        groupId: expect.any(String),
        totalRecordCount: 3,
        totalChunkCount: 3,
        chunkIndex: 1,
        scope: 'chunk',
      });
      expect(recordRepository.insertStreamContexts[1]?.batchMutation).toEqual({
        operationId: expect.any(String),
        groupId: expect.any(String),
        totalRecordCount: 3,
        totalChunkCount: 3,
        chunkIndex: 2,
        scope: 'chunk',
      });

      expect(trackingUndoRedoService.recordEntryCalls).toBe(3);
      expect(new Set(trackingUndoRedoService.entries.map((entry) => entry.groupId)).size).toBe(1);
    });

    it('snapshots filtered target rows before streamed paste chunks mutate them', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const viewId = table.views()[0]!.id();
      const textFieldKey = textFieldId.toString();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new OffsetPagingFilteredTableRecordQueryRepository(
        Array.from({ length: 5 }, (_, index) => ({
          id: `rec${String.fromCharCode(97 + index).repeat(16)}`,
          fields: { [textFieldKey]: null },
          version: 1,
        })),
        textFieldKey,
        2
      );

      const recordRepository = new FakeTableRecordRepository();
      recordRepository.onUpdatedRecord = (record) =>
        recordQueryRepository.applyUpdatedRecord(record);

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteStreamApplicationService(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const command = PasteStreamCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 4],
        ],
        content: [['Row 1'], ['Row 2'], ['Row 3'], ['Row 4'], ['Row 5']],
        filter: {
          conjunction: 'and',
          items: [{ fieldId: textFieldKey, operator: 'isEmpty', value: null }],
        },
        batchSize: 1,
      })._unsafeUnwrap();

      const events = [];
      for await (const event of handler.createStream(createContext(), command)) {
        events.push(event);
      }

      const doneEvent = events.find((event) => event.id === 'done');
      expect(doneEvent).toMatchObject({
        id: 'done',
        totalCount: 5,
        processedCount: 5,
        updatedCount: 5,
        createdCount: 0,
      });
      expect(recordRepository.updated).toHaveLength(5);
      expect(recordRepository.inserted).toHaveLength(0);
      expect(recordQueryRepository.records.map((record) => record.fields[textFieldKey])).toEqual([
        'Row 1',
        'Row 2',
        'Row 3',
        'Row 4',
        'Row 5',
      ]);
    });

    it('reuses plugin prepared state across paste stream chunks', async () => {
      const { table, tableId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);
      const recordRepository = new FakeTableRecordRepository();
      const recordQueryRepository = new FakeTableRecordQueryRepository();
      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const preparedState = { cacheKey: 'prepared-once' };
      const prepareScopes: Array<'operation' | 'chunk'> = [];
      const prepareStates: unknown[] = [];
      let heavyPrepareCalls = 0;

      const handler = new PasteStreamApplicationService(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        recordRepository,
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        noopPasteLinkAutoResolveService,
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        createRecordWritePluginRunner([
          {
            name: 'paste-stream-cached-plugin',
            supports: (operation) => operation === RecordWriteOperationKind.paste,
            async prepare(context, previousPreparedState) {
              prepareScopes.push(context.orchestration?.scope ?? 'operation');
              prepareStates.push(previousPreparedState);

              if (context.orchestration?.scope === 'operation') {
                heavyPrepareCalls += 1;
                return ok(preparedState);
              }

              return ok(previousPreparedState);
            },
          },
        ]),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const command = PasteStreamCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['A'], ['B'], ['C']],
        batchSize: 1,
      })._unsafeUnwrap();

      for await (const event of handler.createStream(createContext(), command)) {
        expect(event).toBeDefined();
      }

      expect(heavyPrepareCalls).toBe(1);
      expect(prepareScopes).toEqual(['operation', 'chunk', 'chunk', 'chunk']);
      expect(prepareStates).toEqual([undefined, preparedState, preparedState, preparedState]);
    });
  });
});
