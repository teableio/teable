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
import { RecordsBatchUpdated } from '../domain/table/events/RecordsBatchUpdated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { RecordId } from '../domain/table/records/RecordId';
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
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import type {
  ITableRecordRepository,
  RecordMutationResult,
  BatchRecordMutationResult,
  UpdateManyResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { UpdateRecordsCommand } from './UpdateRecordsCommand';
import { UpdateRecordsHandler } from './UpdateRecordsHandler';
import {
  createRecordWritePluginRunner,
  createTrackedRecordWritePlugin,
  expectRecordWritePluginToBeSkipped,
} from './recordWritePluginRunnerTestUtils';

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
  lastSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined;
  lastMutateSpec: ICellValueSpec | undefined;
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
    ___: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<{ totalUpdated: number }, DomainError>> {
    return ok({ totalUpdated: 0 });
  }

  async deleteMany(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
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
}

describe('UpdateRecordsHandler', () => {
  it('updates matched records and publishes batch event', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const recordIdA = `rec${'a'.repeat(16)}`;
    const recordIdB = `rec${'b'.repeat(16)}`;

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

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

    const handler = new UpdateRecordsHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      undoRedoService as unknown as UndoRedoService,
      unitOfWork
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

    const batchEvent = eventBus.published.find((event) => event instanceof RecordsBatchUpdated) as
      | RecordsBatchUpdated
      | undefined;
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
    const tableQueryService = new TableQueryService(tableRepository);

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

    const handler = new UpdateRecordsHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner([plugin]),
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      undoRedoService as unknown as UndoRedoService,
      unitOfWork
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
    const tableQueryService = new TableQueryService(tableRepository);

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

    const handler = new UpdateRecordsHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      undoRedoService as unknown as UndoRedoService,
      unitOfWork
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
    expect(eventBus.published.some((event) => event instanceof RecordsBatchUpdated)).toBe(true);
    expect(undoRedoService.entries).toHaveLength(1);
  });

  it('returns early when the filter matches no records', async () => {
    const { table, tableId, textFieldId, singleSelectFieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();

    const handler = new UpdateRecordsHandler(
      tableQueryService,
      recordRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      undoRedoService as unknown as UndoRedoService,
      unitOfWork
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
    expect(eventBus.published).toHaveLength(0);
    expect(undoRedoService.entries).toHaveLength(0);
  });
});
