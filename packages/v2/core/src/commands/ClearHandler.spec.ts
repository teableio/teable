import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableQueryService } from '../application/services/TableQueryService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { isRecordsBatchUpdatedEvent } from '../domain/table/events/RecordsBatchUpdated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { FormulaExpression } from '../domain/table/fields/types/FormulaExpression';
import type { RecordId } from '../domain/table/records/RecordId';
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
import type {
  ITableRecordQueryRepository,
  ITableRecordQueryOptions,
  ITableRecordQueryStreamOptions,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type {
  BatchRecordMutationResult,
  UpdateManyStreamBatchInput,
  RecordMutationResult,
  UpdateManyStreamResult,
  ITableRecordRepository,
} from '../ports/TableRecordRepository';
import { isUpdateManyStreamBatch } from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { ClearCommand } from './ClearCommand';
import { ClearHandler, ClearStreamHandler } from './ClearHandler';
import { ClearStreamCommand } from './ClearStreamCommand';
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

class TrackingUndoRedoService {
  recordEntryCalls = 0;

  async recordEntry() {
    this.recordEntryCalls += 1;
    return ok(undefined);
  }
}

const buildTable = () => {
  const baseId = BaseId.create(`bse${'e'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
  const primaryFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
  const formulaFieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
  const expression = FormulaExpression.create(`{${primaryFieldId.toString()}} + 1`)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('Clear Test')._unsafeUnwrap());
  builder
    .field()
    .number()
    .withId(primaryFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .formula()
    .withId(formulaFieldId)
    .withName(FieldName.create('Score')._unsafeUnwrap())
    .withExpression(expression)
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  return { table, tableId, baseId, primaryFieldId, formulaFieldId };
};

const buildProjectionTable = () => {
  const baseId = BaseId.create(`bse${'g'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'h'.repeat(16)}`)._unsafeUnwrap();
  const firstFieldId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();
  const secondFieldId = FieldId.create(`fld${'j'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('Clear Projection Test')._unsafeUnwrap());
  builder
    .field()
    .number()
    .withId(firstFieldId)
    .withName(FieldName.create('First')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(secondFieldId)
    .withName(FieldName.create('Second')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  return { table, tableId, firstFieldId, secondFieldId };
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

  async restore(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  updatedRecords: TableRecord[] = [];
  updateManyStreamUpdatedRecordIds?: ReadonlySet<string>;
  updateManyStreamVersions = new Map<string, number>();
  updateCalls = 0;

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
    _: IExecutionContext,
    __: Table,
    ___: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
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
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    this.updateCalls += 1;
    let totalUpdated = 0;
    const updatedRecords: Array<NonNullable<UpdateManyStreamResult['updatedRecords']>[number]> = [];
    for await (const batchResult of batches) {
      if (batchResult.isErr()) {
        return err(batchResult.error);
      }
      const updates = isUpdateManyStreamBatch(batchResult.value)
        ? batchResult.value.updates
        : batchResult.value;
      for (const update of updates) {
        const recordId = update.record.id().toString();
        if (
          this.updateManyStreamUpdatedRecordIds &&
          !this.updateManyStreamUpdatedRecordIds.has(recordId)
        ) {
          continue;
        }
        this.updatedRecords.push(update.record);
        const storedRecord = this.queryRepository?.records.find((item) => item.id === recordId);
        const configuredNewVersion = this.updateManyStreamVersions.get(recordId);
        const oldVersion =
          storedRecord?.version ??
          (configuredNewVersion !== undefined ? configuredNewVersion - 1 : 0);
        const oldFieldValues: Record<string, unknown> = {};
        if (storedRecord) {
          for (const entry of update.record.fields().entries()) {
            const fieldId = entry.fieldId.toString();
            if (Object.prototype.hasOwnProperty.call(storedRecord.fields, fieldId)) {
              oldFieldValues[fieldId] = storedRecord.fields[fieldId];
            }
          }
        }
        const newVersion =
          configuredNewVersion ?? this.updateQueryRecord(update.record) ?? oldVersion + 1;
        updatedRecords.push({
          recordId: update.record.id(),
          oldVersion,
          newVersion,
          oldFieldValues,
        });
        totalUpdated += 1;
      }
    }
    return ok({
      totalUpdated,
      updatedRecords,
    });
  }

  private updateQueryRecord(record: TableRecord): number | undefined {
    if (!this.queryRepository) {
      return undefined;
    }

    const recordId = record.id().toString();
    const storedRecord = this.queryRepository.records.find((item) => item.id === recordId);
    if (!storedRecord) {
      return undefined;
    }

    const updatedFields: Record<string, unknown> = {};
    for (const entry of record.fields().entries()) {
      updatedFields[entry.fieldId.toString()] = entry.value.toValue();
    }

    storedRecord.fields = {
      ...storedRecord.fields,
      ...updatedFields,
    };
    storedRecord.version += 1;
    return storedRecord.version;
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
  lastFindStreamOptions?: ITableRecordQueryStreamOptions;
  visiblePredicate?: (record: TableRecordReadModel) => boolean;

  async find(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryOptions
  ): Promise<Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>> {
    const records = this.scopedRecords();
    const offset = options?.pagination?.offset()?.toNumber() ?? 0;
    const limit = options?.pagination?.limit()?.toNumber() ?? records.length;
    return ok({
      records: records.slice(offset, offset + limit),
      total: records.length,
    });
  }

  async findOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    if (this.records.length === 0)
      return err({
        code: 'not_found',
        message: 'Record not found',
        tags: ['not-found'],
        toString: () => 'Record not found',
      });
    return ok(this.records[0]!);
  }

  findStream(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    this.lastFindStreamOptions = options;
    const records = this.scopedRecords();
    const pagination = options?.pagination;
    const offset = pagination && 'offset' in pagination ? pagination.offset : 0;
    const limit = pagination?.limit ?? records.length;
    const pageRecords = records.slice(offset, offset + limit);
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const record of pageRecords) {
          yield ok(record);
        }
      },
    };
  }

  private scopedRecords() {
    return this.visiblePredicate ? this.records.filter(this.visiblePredicate) : this.records;
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
    return work({ ...context, transaction });
  }
}

describe('ClearHandler', () => {
  it('clears editable fields and publishes batch updated event', async () => {
    const { table, tableId, primaryFieldId, formulaFieldId } = buildTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const recordId = `rec${'r'.repeat(16)}`;
    const existingVersion = 3;
    recordQueryRepository.records = [
      {
        id: recordId,
        version: existingVersion,
        fields: {
          [primaryFieldId.toString()]: 10,
          [formulaFieldId.toString()]: 11,
        },
      },
    ];

    const recordRepository = new FakeTableRecordRepository(recordQueryRepository);
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new ClearHandler(
      tableQueryService,
      createRecordWritePluginRunner(),
      recordRepository,
      recordQueryRepository,
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [1, 0],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedCount).toBe(1);

    expect(recordRepository.updatedRecords).toHaveLength(1);
    const updated = recordRepository.updatedRecords[0]!;
    const updatedValue = updated.fields().get(primaryFieldId)?.toValue();
    expect(updatedValue).toBeNull();

    const event = eventBus.published.find(isRecordsBatchUpdatedEvent);
    expect(event).toBeDefined();
    expect(event!.updates[0]?.recordId).toBe(recordId);
    expect(event!.updates[0]?.oldVersion).toBe(existingVersion);
    expect(event!.updates[0]?.newVersion).toBe(existingVersion + 1);
  });

  it('omits already empty fields from clear update event changes', async () => {
    const { table, tableId, firstFieldId, secondFieldId } = buildProjectionTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const recordId = `rec${'a'.repeat(16)}`;
    recordQueryRepository.records = [
      {
        id: recordId,
        version: 3,
        fields: {
          [firstFieldId.toString()]: 100,
          [secondFieldId.toString()]: null,
        },
      },
    ];
    const eventBus = new FakeEventBus();
    const handler = new ClearHandler(
      new TableQueryService(tableRepository),
      createRecordWritePluginRunner(),
      new FakeTableRecordRepository(recordQueryRepository),
      recordQueryRepository,
      eventBus,
      noopUndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [1, 0],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedCount).toBe(1);
    const event = eventBus.published.find(isRecordsBatchUpdatedEvent);
    expect(event?.updates).toHaveLength(1);
    expect(event?.updates[0]?.recordId).toBe(recordId);
    expect(event?.updates[0]?.changes).toEqual([
      {
        fieldId: firstFieldId.toString(),
        oldValue: 100,
        newValue: null,
      },
    ]);
  });

  it('does not publish clear update event when storage skips the row', async () => {
    const { table, tableId, firstFieldId } = buildProjectionTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [
      {
        id: `rec${'b'.repeat(16)}`,
        version: 4,
        fields: {
          [firstFieldId.toString()]: 100,
        },
      },
    ];
    const recordRepository = new FakeTableRecordRepository(recordQueryRepository);
    recordRepository.updateManyStreamUpdatedRecordIds = new Set();
    const eventBus = new FakeEventBus();
    const undoRedoService = new TrackingUndoRedoService();
    const handler = new ClearHandler(
      new TableQueryService(tableRepository),
      createRecordWritePluginRunner(),
      recordRepository,
      recordQueryRepository,
      eventBus,
      undoRedoService as unknown as UndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [0, 0],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedCount).toBe(0);
    expect(eventBus.published.find(isRecordsBatchUpdatedEvent)).toBeUndefined();
    expect(undoRedoService.recordEntryCalls).toBe(0);
  });

  it('trims clear targets to plugin-scoped update fields', async () => {
    const { table, tableId, firstFieldId, secondFieldId } = buildProjectionTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [
      {
        id: `rec${'m'.repeat(16)}`,
        version: 1,
        fields: {
          [firstFieldId.toString()]: 100,
          [secondFieldId.toString()]: 200,
        },
      },
    ];

    const recordRepository = new FakeTableRecordRepository();
    const handler = new ClearHandler(
      tableQueryService,
      createRecordWritePluginRunner([
        {
          name: 'scope-update-fields',
          supports: (operation) => operation === RecordWriteOperationKind.updateMany,
          scope: async () => ok({ updateFieldIds: new Set([firstFieldId.toString()]) }),
          guard: async () => ok(undefined),
        },
      ]),
      recordRepository,
      recordQueryRepository,
      new FakeEventBus(),
      noopUndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [1, 0],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedCount).toBe(1);
    const updated = recordRepository.updatedRecords[0]!;
    expect(updated.fields().get(firstFieldId)?.toValue()).toBeNull();
    expect(updated.fields().get(secondFieldId)).toBeUndefined();
  });

  it('trims clear targets per record when plugin field scope varies by record', async () => {
    const { table, tableId, firstFieldId, secondFieldId } = buildProjectionTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [
      {
        id: `rec${'x'.repeat(16)}`,
        version: 1,
        fields: {
          [firstFieldId.toString()]: 100,
          [secondFieldId.toString()]: 200,
        },
      },
      {
        id: `rec${'y'.repeat(16)}`,
        version: 1,
        fields: {
          [firstFieldId.toString()]: 300,
          [secondFieldId.toString()]: 400,
        },
      },
    ];

    const recordRepository = new FakeTableRecordRepository();
    const handler = new ClearHandler(
      tableQueryService,
      createRecordWritePluginRunner([
        {
          name: 'scope-update-fields-per-record',
          supports: (operation) => operation === RecordWriteOperationKind.updateMany,
          scope: async () =>
            ok({
              updateFieldIds: new Set([firstFieldId.toString(), secondFieldId.toString()]),
              resolveUpdateFieldIdsForRecord: (record) =>
                record.fields().get(firstFieldId)?.toValue() === 100
                  ? new Set([firstFieldId.toString()])
                  : new Set([secondFieldId.toString()]),
            }),
          guard: async () => ok(undefined),
        },
      ]),
      recordRepository,
      recordQueryRepository,
      new FakeEventBus(),
      noopUndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [1, 1],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedCount).toBe(2);
    expect(recordRepository.updatedRecords).toHaveLength(2);
    expect(recordRepository.updatedRecords[0]?.fields().get(firstFieldId)?.toValue()).toBeNull();
    expect(recordRepository.updatedRecords[0]?.fields().get(secondFieldId)).toBeUndefined();
    expect(recordRepository.updatedRecords[1]?.fields().get(firstFieldId)).toBeUndefined();
    expect(recordRepository.updatedRecords[1]?.fields().get(secondFieldId)?.toValue()).toBeNull();
  });

  it('skips plugins that do not support updateMany', async () => {
    const { table, tableId, primaryFieldId } = buildTable();
    const viewId = table.views()[0]!.id();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [
      {
        id: `rec${'k'.repeat(16)}`,
        version: 1,
        fields: {
          [primaryFieldId.toString()]: 10,
        },
      },
    ];

    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const { plugin, calls } = createTrackedRecordWritePlugin([RecordWriteOperationKind.createOne]);

    const handler = new ClearHandler(
      tableQueryService,
      createRecordWritePluginRunner([plugin]),
      recordRepository,
      recordQueryRepository,
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [0, 0],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    result._unsafeUnwrap();

    expect(calls.supports).toEqual([
      RecordWriteOperationKind.updateMany,
      RecordWriteOperationKind.updateMany,
    ]);
    expect(calls.prepare).toHaveLength(0);
    expect(calls.guard).toHaveLength(0);
    expect(calls.beforePersist).toHaveLength(0);
    expect(calls.afterCommit).toHaveLength(0);
  });

  it('returns 0 when only computed columns are selected', async () => {
    const { table, tableId } = buildTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const handler = new ClearHandler(
      new TableQueryService(tableRepository),
      createRecordWritePluginRunner(),
      new FakeTableRecordRepository(),
      new FakeTableRecordQueryRepository(),
      new FakeEventBus(),
      noopUndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [1, 0],
        [1, 0],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedCount).toBe(0);
  });

  it('uses projection order when mapping clear column indices', async () => {
    const { table, tableId, firstFieldId, secondFieldId } = buildProjectionTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [
      {
        id: `rec${'s'.repeat(16)}`,
        version: 1,
        fields: {
          [firstFieldId.toString()]: 100,
          [secondFieldId.toString()]: 200,
        },
      },
    ];

    const recordRepository = new FakeTableRecordRepository();
    const handler = new ClearHandler(
      tableQueryService,
      createRecordWritePluginRunner(),
      recordRepository,
      recordQueryRepository,
      new FakeEventBus(),
      noopUndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [0, 0],
      ],
      projection: [secondFieldId.toString(), firstFieldId.toString()],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedCount).toBe(1);
    const updated = recordRepository.updatedRecords[0]!;
    expect(updated.fields().get(secondFieldId)?.toValue()).toBeNull();
    expect(updated.fields().get(firstFieldId)).toBeUndefined();
  });

  it('uses request groupBy when resolving clear row order', async () => {
    const { table, tableId, firstFieldId, secondFieldId } = buildProjectionTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [
      {
        id: `rec${'t'.repeat(16)}`,
        version: 1,
        fields: {
          [firstFieldId.toString()]: 1,
          [secondFieldId.toString()]: 2,
        },
      },
    ];

    const handler = new ClearHandler(
      tableQueryService,
      createRecordWritePluginRunner(),
      new FakeTableRecordRepository(),
      recordQueryRepository,
      new FakeEventBus(),
      noopUndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [0, 0],
      ],
      groupBy: [{ fieldId: secondFieldId.toString(), order: 'desc' }],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);

    const orderBy = recordQueryRepository.lastFindStreamOptions?.orderBy;
    expect(orderBy?.length).toBeGreaterThan(0);
    const firstOrder = orderBy?.[0];
    expect(firstOrder && 'fieldId' in firstOrder).toBe(true);
    if (firstOrder && 'fieldId' in firstOrder) {
      expect(firstOrder.fieldId.toString()).toBe(secondFieldId.toString());
      expect(firstOrder.direction).toBe('desc');
    }
  });

  it('stream clear omits already empty fields from update event changes', async () => {
    const { table, tableId, firstFieldId, secondFieldId } = buildProjectionTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const recordId = `rec${'c'.repeat(16)}`;
    recordQueryRepository.records = [
      {
        id: recordId,
        version: 5,
        fields: {
          [firstFieldId.toString()]: 100,
          [secondFieldId.toString()]: null,
        },
      },
    ];
    const eventBus = new FakeEventBus();
    const handler = new ClearStreamHandler(
      new TableQueryService(tableRepository),
      createRecordWritePluginRunner(),
      new FakeTableRecordRepository(recordQueryRepository),
      recordQueryRepository,
      eventBus,
      noopUndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearStreamCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [1, 0],
      ],
      batchSize: 2,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      id: 'done',
      clearedCount: 1,
      data: {
        clearedCount: 1,
        clearedRecordIds: [recordId],
      },
    });
    const updateEvent = eventBus.published.find(isRecordsBatchUpdatedEvent);
    expect(updateEvent?.updates[0]?.changes).toEqual([
      {
        fieldId: firstFieldId.toString(),
        oldValue: 100,
        newValue: null,
      },
    ]);
  });

  it('snapshots filtered target rows before streamed clear chunks mutate them', async () => {
    const { table, tableId, primaryFieldId } = buildTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = Array.from({ length: 5 }, (_, index) => ({
      id: `rec${index.toString(36).padStart(16, '0')}`,
      version: 1,
      fields: {
        [primaryFieldId.toString()]: index + 1,
      },
    }));
    recordQueryRepository.visiblePredicate = (record) =>
      record.fields[primaryFieldId.toString()] !== null &&
      record.fields[primaryFieldId.toString()] !== undefined;
    const originalRecordIds = recordQueryRepository.records.map((record) => record.id);

    const recordRepository = new FakeTableRecordRepository(recordQueryRepository);
    const handler = new ClearStreamHandler(
      new TableQueryService(tableRepository),
      createRecordWritePluginRunner(),
      recordRepository,
      recordQueryRepository,
      new FakeEventBus(),
      noopUndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearStreamCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [[0, 4]],
      type: 'rows',
      batchSize: 2,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const events = [];
    for await (const event of result._unsafeUnwrap()) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      id: 'done',
      totalCount: 5,
      clearedCount: 5,
      data: {
        clearedCount: 5,
        clearedRecordIds: originalRecordIds,
      },
    });
    expect(recordRepository.updatedRecords.map((record) => record.id().toString())).toEqual(
      originalRecordIds
    );
  });
});
