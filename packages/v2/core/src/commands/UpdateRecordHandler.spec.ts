import { readFileSync } from 'node:fs';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import type { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import type { RecordWriteUndoRedoPlanService } from '../application/services/RecordWriteUndoRedoPlanService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type {
  RecordUpdateUndoRedoInput,
  RecordSnapshotUndoRedoInput,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldOptionsAdded } from '../domain/table/events/FieldOptionsAdded';
import { RecordReordered } from '../domain/table/events/RecordReordered';
import { isRecordUpdatedEvent } from '../domain/table/events/RecordUpdated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import type { MultipleSelectField } from '../domain/table/fields/types/MultipleSelectField';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import type { SingleSelectField } from '../domain/table/fields/types/SingleSelectField';
import type { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import { SetRowOrderValueSpec } from '../domain/table/records/specs/values/SetRowOrderValueSpec';
import { SetUserValueByIdentifierSpec } from '../domain/table/records/specs/values/SetUserValueByIdentifierSpec';
import {
  SetUserValueSpec,
  type UserItem,
} from '../domain/table/records/specs/values/SetUserValueSpec';
import type { TableRecord } from '../domain/table/records/TableRecord';
import { CellValue } from '../domain/table/records/values/CellValue';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import { EventBusDomainWriteTransaction } from '../ports/memory/EventBusDomainWriteTransaction';
import type { IRecordOrderCalculator } from '../ports/RecordOrderCalculator';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  ITableRecordQueryOptions,
  ITableRecordQueryRepository,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type {
  ITableRecordRepository,
  RecordMutationResult,
  BatchRecordMutationResult,
  UpdateOptions,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import {
  createTableSchemaCoordinationLease,
  type ITableSchemaCoordination,
  type TableSchemaCoordinationMode,
} from '../ports/TableSchemaCoordination';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import {
  createRecordWritePluginRunner,
  createTrackedRecordWritePlugin,
  expectRecordWritePluginToBeSkipped,
} from './recordWritePluginRunnerTestUtils';
import { UpdateRecordApplicationService } from './UpdateRecordApplicationService';
import { UpdateRecordCommand } from './UpdateRecordCommand';
import { UpdateRecordHandler } from './UpdateRecordHandler';

const createContext = (config?: IExecutionContext['config']): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId, config };
};

const createTableUpdateFlow = (
  tableRepository: FakeTableRepository,
  eventBus: FakeEventBus,
  unitOfWork: FakeUnitOfWork
) => new TableUpdateFlow(tableRepository, new FakeTableSchemaRepository(), eventBus, unitOfWork);

const noopRecordWriteUndoRedoPlanService = {
  captureSelectOptionSideEffects: async () => ok({ undoCommands: [], redoCommands: [] }),
} as unknown as RecordWriteUndoRedoPlanService;

const noopRecordChangedValueDecoratorService = {
  decorateChangedFields: async (_table: Table, changedFields?: ReadonlyMap<string, unknown>) =>
    ok(changedFields),
  decorateChangedFieldsByRecord: async (
    _table: Table,
    changedFieldsByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>
  ) => ok(changedFieldsByRecord),
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'u'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Update Records')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
  const numberFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
  const singleSelectFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  const multiSelectFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
  const userFieldId = FieldId.create(`fld${'u'.repeat(16)}`)._unsafeUnwrap();
  const openOption = SelectOption.create({ name: 'Open', color: 'blue' })._unsafeUnwrap();
  const tagOption = SelectOption.create({ name: 'Tag A', color: 'green' })._unsafeUnwrap();

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
    .withOptions([openOption])
    .done();
  builder
    .field()
    .multipleSelect()
    .withId(multiSelectFieldId)
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withOptions([tagOption])
    .done();
  builder
    .field()
    .user()
    .withId(userFieldId)
    .withName(FieldName.create('User')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    baseId,
    tableId,
    textFieldId,
    numberFieldId,
    singleSelectFieldId,
    multiSelectFieldId,
    userFieldId,
  };
};

const buildTableWithLink = () => {
  const baseId = BaseId.create(`bse${'l'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'l'.repeat(16)}`)._unsafeUnwrap();
  const foreignTableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
  const foreignPrimaryFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Update Link Records')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
  const linkFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();
  const linkConfig = LinkFieldConfig.create({
    baseId: baseId.toString(),
    relationship: 'manyMany',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: foreignPrimaryFieldId.toString(),
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
    baseId,
    tableId,
    foreignTableId,
    foreignPrimaryFieldId,
    textFieldId,
    linkFieldId,
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

  async duplicatePhysicalRows(
    _context: any,
    _plan: any
  ): Promise<Result<{ rowCount: number; recordIds: string[] }, DomainError>> {
    return ok({ rowCount: 0, recordIds: [] });
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
  lastContext: IExecutionContext | undefined;
  lastRecordId: RecordId | undefined;
  lastMutateSpec: ICellValueSpec | undefined;
  lastUpdateOptions: UpdateOptions | undefined;
  omitUpdateSnapshot = false;
  mutationApplied: boolean | undefined = true;
  updateSnapshotVersions = { oldVersion: 1, newVersion: 2 };
  changedFields: ReadonlyMap<string, unknown> | undefined;
  streamedUpdates: RecordUpdateResult[] = [];

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

  async updateOne(
    context: IExecutionContext,
    _: Table,
    recordId: RecordId,
    mutateSpec: ICellValueSpec,
    options?: UpdateOptions
  ): Promise<Result<RecordMutationResult, DomainError>> {
    this.lastContext = context;
    this.lastRecordId = recordId;
    this.lastMutateSpec = mutateSpec;
    this.lastUpdateOptions = options;
    return ok(
      this.omitUpdateSnapshot
        ? {
            mutationApplied: this.mutationApplied,
          }
        : {
            mutationApplied: this.mutationApplied,
            changedFields: this.changedFields,
            updateSnapshot: {
              previous: {
                recordId: recordId.toString(),
                fields: {},
              },
              current: {
                recordId: recordId.toString(),
                fields: {},
              },
              oldVersion: this.updateSnapshotVersions.oldVersion,
              newVersion: this.updateSnapshotVersions.newVersion,
            },
          }
    );
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
    batches: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<{ totalUpdated: number; updatedRecords: [] }, DomainError>> {
    for (const batch of batches) {
      if (batch.isOk()) this.streamedUpdates.push(...batch.value);
    }
    return ok({ totalUpdated: 0, updatedRecords: [] });
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
  record: TableRecordReadModel | undefined;
  records: TableRecordReadModel[] = [];
  failFindOne: DomainError | undefined;
  findCalls = 0;
  findOneCalls = 0;
  findOneOptions: Array<
    Pick<ITableRecordQueryOptions, 'mode' | 'includeOrders' | 'recordReadQuerySource'> | undefined
  > = [];

  async find(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>> {
    this.findCalls += 1;
    return ok({ records: [], total: 0 });
  }

  async findOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId,
    options?: Pick<ITableRecordQueryOptions, 'mode' | 'includeOrders' | 'recordReadQuerySource'>
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    this.findOneCalls += 1;
    this.findOneOptions.push(options);
    if (this.failFindOne) return err(this.failFindOne);
    const record = this.records.shift() ?? this.record;
    if (!record) return err(domainError.notFound({ message: 'Record not found' }));
    return ok(record);
  }

  async *findStream(): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    // Noop: yields nothing
  }
}

class FakeRecordOrderCalculator implements IRecordOrderCalculator {
  async calculateOrders(): Promise<Result<ReadonlyArray<number>, DomainError>> {
    return ok([1024]);
  }
}

class RecordingTableSchemaCoordination implements ITableSchemaCoordination {
  readonly calls: Array<{ tableIds: ReadonlyArray<string>; mode: TableSchemaCoordinationMode }> =
    [];
  readonly events: string[] = [];
  releaseCount = 0;
  failMode?: TableSchemaCoordinationMode;
  onAcquire?: (mode: TableSchemaCoordinationMode) => void;

  constructor(private readonly failure?: DomainError) {}

  async acquire(
    _context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode
  ) {
    this.calls.push({ tableIds, mode });
    this.events.push(`acquire:${mode}`);
    if (this.failure && (this.failMode === undefined || this.failMode === mode)) {
      return err(this.failure);
    }
    this.onAcquire?.(mode);
    return ok(
      createTableSchemaCoordinationLease(mode, tableIds, async () => {
        this.releaseCount += 1;
        this.events.push(`release:${mode}`);
      })
    );
  }
}

const createHandler = (
  tableQueryService: TableQueryService,
  recordRepository: ITableRecordRepository,
  recordQueryRepository: ITableRecordQueryRepository,
  recordMutationSpecResolver: RecordMutationSpecResolverService,
  recordWritePluginRunner = createRecordWritePluginRunner(),
  tableUpdateFlow: TableUpdateFlow,
  eventBus: IEventBus,
  undoRedoStackService: UndoRedoStackService,
  unitOfWork: IUnitOfWork,
  foreignTableLoader?: ConstructorParameters<typeof UpdateRecordApplicationService>[12],
  tableSchemaCoordination?: ConstructorParameters<typeof UpdateRecordApplicationService>[13]
) =>
  new UpdateRecordHandler(
    new UpdateRecordApplicationService(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordOrderCalculator(),
      recordMutationSpecResolver,
      noopRecordChangedValueDecoratorService,
      recordWritePluginRunner,
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      tableUpdateFlow,
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      undoRedoStackService,
      foreignTableLoader,
      tableSchemaCoordination
    )
  );

it('keeps the handler limited to application forwarding', () => {
  const source = readFileSync(new URL('./UpdateRecordHandler.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/order|typecast|FieldKeyResolver|select.option|acquire|release/i);
  expect(source).toContain('return this.applicationService.execute(context, command)');
});

class FakeRecordMutationSpecResolverService {
  needsResolutionValue = false;
  resolveCalls: ICellValueSpec[] = [];
  resolveImpl?: (spec: ICellValueSpec) => ICellValueSpec;

  needsResolution(_: ICellValueSpec): Result<boolean, DomainError> {
    return ok(this.needsResolutionValue);
  }

  async resolveAndReplace(
    _: IExecutionContext,
    _tableId: TableId,
    spec: ICellValueSpec
  ): Promise<Result<ICellValueSpec, DomainError>> {
    this.resolveCalls.push(spec);
    const resolved = this.resolveImpl ? this.resolveImpl(spec) : spec;
    return ok(resolved);
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
  calls: Array<RecordUpdateUndoRedoInput | RecordSnapshotUndoRedoInput> = [];
  entryCalls: Array<unknown> = [];

  async appendRecordUpdate(
    _context: IExecutionContext,
    params: RecordUpdateUndoRedoInput
  ): Promise<Result<void, DomainError>> {
    this.calls.push(params);
    return ok(undefined);
  }

  async appendRecordUpdateFromSnapshot(
    _context: IExecutionContext,
    params: RecordSnapshotUndoRedoInput
  ): Promise<Result<void, DomainError>> {
    this.calls.push(params);
    return ok(undefined);
  }

  async appendEntry(
    _context: IExecutionContext,
    _tableId: TableId,
    entry: unknown
  ): Promise<Result<void, DomainError>> {
    this.entryCalls.push(entry);
    return ok(undefined);
  }
}

describe('UpdateRecordHandler', () => {
  it('updates record and publishes event', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const recordResult = table
      .createRecord(
        new Map([
          [textFieldId.toString(), 'Old Title'],
          [numberFieldId.toString(), 1],
        ])
      )
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: {
        [textFieldId.toString()]: 'Old Title',
        [numberFieldId.toString()]: 1,
      },
      version: 1,
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      unitOfWork
    );

    const commandResult = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'New Title' },
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.record.fields().get(textFieldId)?.toValue()).toBe('New Title');
    expect(payload.record.fields().get(numberFieldId)?.toValue()).toBe(1);
    expect(recordRepository.lastRecordId?.equals(recordResult.record.id())).toBe(true);
    expect(recordRepository.lastContext?.transaction?.kind).toBe('unitOfWorkTransaction');
    expect(eventBus.published.some(isRecordUpdatedEvent)).toBe(true);
    expect(unitOfWork.transactions.length).toBe(1);
  });

  it('omits unresolved unchanged link values from the update response', async () => {
    const { table, tableId, textFieldId, linkFieldId } = buildTableWithLink();
    const targetRecordId = `rec${'r'.repeat(16)}`;
    const recordResult = table
      .createRecord(
        new Map([
          [textFieldId.toString(), 'Old Title'],
          [linkFieldId.toString(), null],
        ])
      )
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: {
        [textFieldId.toString()]: 'Old Title',
        [linkFieldId.toString()]: { id: targetRecordId },
      },
      version: 1,
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      unitOfWork
    );

    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'New Title' },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const payload = result._unsafeUnwrap();

    expect(payload.record.fields().get(textFieldId)?.toValue()).toBe('New Title');
    expect(payload.record.fields().get(linkFieldId)).toBeUndefined();
    expect(recordQueryRepository.findOneCalls).toBe(1);
    expect(recordQueryRepository.findOneOptions).toMatchObject([
      { mode: 'stored', includeOrders: true },
    ]);
  });

  it('preserves persisted link titles when a typecast update only provides ids', async () => {
    const { table, tableId, textFieldId, linkFieldId } = buildTableWithLink();
    const targetRecordId = `rec${'r'.repeat(16)}`;
    const persistedLinkValue = [{ id: targetRecordId, title: 'Target Title' }];
    const recordResult = table
      .createRecord(
        new Map([
          [textFieldId.toString(), 'Old Title'],
          [linkFieldId.toString(), persistedLinkValue],
        ])
      )
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    recordRepository.changedFields = new Map([[linkFieldId.toString(), persistedLinkValue]]);
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: {
        [textFieldId.toString()]: 'Old Title',
        [linkFieldId.toString()]: [{ id: targetRecordId, title: 'Old Target Title' }],
      },
      version: 1,
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      unitOfWork
    );

    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [linkFieldId.toString()]: [{ id: targetRecordId }] },
      typecast: true,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const payload = result._unsafeUnwrap();
    const linkValue = payload.record.fields().get(linkFieldId)?.toValue();

    expect(linkValue).toEqual(persistedLinkValue);
    expect(
      eventBus.published
        .filter(isRecordUpdatedEvent)
        .flatMap((event) => event.changes)
        .find((change) => change.fieldId === linkFieldId.toString())?.newValue
    ).toEqual(persistedLinkValue);
  });

  it('fills missing persisted link titles for id-only link updates without typecast', async () => {
    const {
      table,
      baseId,
      tableId,
      foreignTableId,
      foreignPrimaryFieldId,
      textFieldId,
      linkFieldId,
    } = buildTableWithLink();
    const targetRecordId = `rec${'r'.repeat(16)}`;
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();
    const foreignTable = Table.builder()
      .withId(foreignTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Foreign Records')._unsafeUnwrap())
      .field()
      .singleLineText()
      .withId(foreignPrimaryFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done()
      .view()
      .defaultGrid()
      .done()
      .build()
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table, foreignTable);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: {
        [textFieldId.toString()]: 'Old Title',
        [linkFieldId.toString()]: null,
      },
      version: 1,
    };

    const foreignTableLoader = new ForeignTableLoaderService(tableRepository);
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      unitOfWork,
      foreignTableLoader
    );

    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [linkFieldId.toString()]: [{ id: targetRecordId }] },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(recordRepository.lastUpdateOptions?.fillLinkTitles).toBe(true);
    expect(
      recordRepository.lastUpdateOptions?.fillLinkTitleForeignTables?.get(table.id().toString())
    ).toBeUndefined();
    expect(
      recordRepository.lastUpdateOptions?.fillLinkTitleForeignTables?.get(foreignTableId.toString())
    ).toBe(foreignTable);
  });

  it('skips plugins that do not support updateOne', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Old Title' },
      version: 1,
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const { plugin, calls } = createTrackedRecordWritePlugin([RecordWriteOperationKind.createOne]);

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner([plugin]),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      unitOfWork
    );

    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'New Title' },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    result._unsafeUnwrap();

    expectRecordWritePluginToBeSkipped(calls, RecordWriteOperationKind.updateOne);
  });

  it('checks plugin scope against the loaded record without an extra query', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Old Title' },
      version: 1,
    };

    const scopedPlugin = {
      name: 'scoped-update',
      supports: (operation: RecordWriteOperationKind) =>
        operation === RecordWriteOperationKind.updateOne,
      scope: () =>
        ok({
          recordSpec: {
            isSatisfiedBy: () => false,
            mutate: (candidate: TableRecord) => ok(candidate),
            accept: () => ok(undefined),
          } satisfies ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
        }),
    };

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner([scopedPlugin]),
      createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
      new FakeEventBus(),
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      new FakeUnitOfWork()
    );

    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'New Title' },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'record_write_plugin.scope_forbidden',
    });
    expect(recordQueryRepository.findOneCalls).toBe(1);
    expect(recordQueryRepository.findCalls).toBe(0);
  });

  it('checks plugin field scope against the loaded record', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const recordResult = table
      .createRecord(
        new Map<string, string | number>([
          [textFieldId.toString(), 'Old Title'],
          [numberFieldId.toString(), 100],
        ])
      )
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: {
        [textFieldId.toString()]: 'Old Title',
        [numberFieldId.toString()]: 100,
      },
      version: 1,
    };

    const scopedPlugin = {
      name: 'scoped-update-fields',
      supports: (operation: RecordWriteOperationKind) =>
        operation === RecordWriteOperationKind.updateOne,
      scope: () =>
        ok({
          updateFieldIds: new Set([textFieldId.toString(), numberFieldId.toString()]),
          resolveUpdateFieldIdsForRecord: () => new Set([textFieldId.toString()]),
        }),
    };

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner([scopedPlugin]),
      createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
      new FakeEventBus(),
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      new FakeUnitOfWork()
    );

    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [numberFieldId.toString()]: 200 },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'record_write_plugin.update_fields_forbidden',
      details: {
        deniedFieldIds: [numberFieldId.toString()],
      },
    });
    expect(recordQueryRepository.findOneCalls).toBe(1);
    expect(recordQueryRepository.findCalls).toBe(0);
  });

  it('resolves link titles when typecast is enabled', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Old Title' },
      version: 1,
    };

    const resolver = new FakeRecordMutationSpecResolverService();
    resolver.needsResolutionValue = true;

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      resolver as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
      new FakeEventBus(),
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      new FakeUnitOfWork()
    );

    const commandResult = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'New Title' },
      typecast: true,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(resolver.resolveCalls.length).toBe(1);
  });

  it('auto creates select options when typecast is enabled', async () => {
    const { table, tableId, textFieldId, singleSelectFieldId, multiSelectFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Old Title' },
      version: 1,
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      unitOfWork
    );

    const commandResult = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      typecast: true,
      fields: {
        [singleSelectFieldId.toString()]: 'In Progress',
        [multiSelectFieldId.toString()]: ['Tag A', 'Tag B'],
      },
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(tableRepository.updated.length).toBe(1);
    const updatedTable = tableRepository.updated[0];
    if (!updatedTable) {
      throw new Error('Expected updated table');
    }

    const singleField = updatedTable
      .getField((field) => field.id().equals(singleSelectFieldId))
      ._unsafeUnwrap() as SingleSelectField;
    const singleNames = singleField.selectOptions().map((option) => option.name().toString());
    expect(singleNames).toContain('In Progress');

    const multiField = updatedTable
      .getField((field) => field.id().equals(multiSelectFieldId))
      ._unsafeUnwrap() as MultipleSelectField;
    const multiNames = multiField.selectOptions().map((option) => option.name().toString());
    expect(multiNames).toContain('Tag B');

    const fieldOptionEvents = eventBus.published.filter(
      (event) => event instanceof FieldOptionsAdded
    );
    expect(fieldOptionEvents).toHaveLength(2);
    expect(eventBus.published).toHaveLength(3);
    expect(eventBus.published[0]).toBeInstanceOf(FieldOptionsAdded);
    expect(eventBus.published[1]).toBeInstanceOf(FieldOptionsAdded);
    expect(isRecordUpdatedEvent(eventBus.published[eventBus.published.length - 1]!)).toBe(true);
  });

  it('rejects auto-created select options when update exceeds configured max', async () => {
    const { table, tableId, textFieldId, singleSelectFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Old Title' },
      version: 1,
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      unitOfWork
    );

    const commandResult = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      typecast: true,
      fields: {
        [singleSelectFieldId.toString()]: 'In Progress',
      },
    });

    const result = await handler.handle(
      createContext({
        selectFieldOptions: {
          maxChoicesPerField: 1,
        },
      }),
      commandResult._unsafeUnwrap()
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.field.select_options_limit');
    expect(tableRepository.updated).toHaveLength(0);
    expect(eventBus.published).toHaveLength(0);
  });

  it('writes other fields when an auto-created select option would exceed the cap', async () => {
    const { table, tableId, textFieldId, singleSelectFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Old Title' },
      version: 1,
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      unitOfWork
    );

    const commandResult = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      typecast: true,
      fields: {
        [textFieldId.toString()]: 'Kept Title',
        [singleSelectFieldId.toString()]: 'In Progress',
      },
    });

    const result = await handler.handle(
      createContext({
        selectFieldOptions: {
          maxChoicesPerField: 1,
        },
      }),
      commandResult._unsafeUnwrap()
    );

    expect(result.isOk()).toBe(true);
    expect(tableRepository.updated).toHaveLength(0);
    expect(eventBus.published.some((event) => isRecordUpdatedEvent(event))).toBe(true);
  });

  it('returns error when record query fails', async () => {
    const { table, tableId, textFieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.failFindOne = domainError.notFound({ message: 'Record missing' });

    const handler = createHandler(
      tableQueryService,
      new FakeTableRecordRepository(),
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
      new FakeEventBus(),
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      new FakeUnitOfWork()
    );

    const commandResult = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: `rec${'z'.repeat(16)}`,
      fields: { [textFieldId.toString()]: 'New Title' },
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('Record missing');
  });

  it('returns error when repository update snapshot is missing', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    recordRepository.omitUpdateSnapshot = true;
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Old Title' },
      version: 1,
    };

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
      new FakeEventBus(),
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      new FakeUnitOfWork()
    );

    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'New Title' },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record.update_snapshot.unavailable');
  });

  it('does not require an update snapshot when a stale no-op update was not persisted', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    recordRepository.omitUpdateSnapshot = true;
    recordRepository.mutationApplied = false;
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Old Title' },
      version: 1,
    };

    const eventBus = new FakeEventBus();
    const undoRedoService = new FakeUndoRedoService();
    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, eventBus, new FakeUnitOfWork()),
      eventBus,
      undoRedoService as unknown as UndoRedoStackService,
      new FakeUnitOfWork()
    );

    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'New Title' },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(eventBus.published.some(isRecordUpdatedEvent)).toBe(false);
    expect(undoRedoService.calls).toHaveLength(0);
  });

  it('event changes contain resolved values after typecast user field resolution', async () => {
    const { table, tableId, textFieldId, userFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Title' },
      version: 1,
    };

    const resolver = new FakeRecordMutationSpecResolverService();
    resolver.needsResolutionValue = true;
    resolver.resolveImpl = (spec) => {
      if (spec instanceof SetUserValueByIdentifierSpec) {
        const resolvedUser: UserItem = {
          id: spec.identifiers[0]!,
          title: 'Alice',
          email: 'alice@example.com',
          avatarUrl: `/api/attachments/read/public/avatar/${spec.identifiers[0]}`,
        };
        return new SetUserValueSpec(
          spec.fieldId,
          CellValue.fromValidated<UserItem[]>(resolvedUser as unknown as UserItem[] | null)
        );
      }
      return spec;
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = createHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      resolver as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      unitOfWork
    );

    const commandResult = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      typecast: true,
      fields: {
        [userFieldId.toString()]: 'usr-1',
      },
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    const recordUpdatedEvent = eventBus.published.find(isRecordUpdatedEvent);
    expect(recordUpdatedEvent).toBeDefined();

    const userChange = recordUpdatedEvent!.changes.find(
      (c) => c.fieldId === userFieldId.toString()
    );
    expect(userChange).toBeDefined();
    expect(userChange!.newValue).toEqual({
      id: 'usr-1',
      title: 'Alice',
      email: 'alice@example.com',
      avatarUrl: '/api/attachments/read/public/avatar/usr-1',
    });
  });

  describe('field key mapping', () => {
    it('returns fieldKeyMapping using fieldId when input uses fieldId', async () => {
      const { table, tableId, textFieldId, numberFieldId } = buildTable();
      const recordResult = table
        .createRecord(
          new Map<string, string | number>([
            [textFieldId.toString(), 'Old Title'],
            [numberFieldId.toString(), 100],
          ])
        )
        ._unsafeUnwrap();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordRepository = new FakeTableRecordRepository();
      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.record = {
        id: recordResult.record.id().toString(),
        version: 1,
        fields: {
          [textFieldId.toString()]: 'Old Title',
          [numberFieldId.toString()]: 100,
        },
      };

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        createRecordWritePluginRunner(),
        createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
        new FakeEventBus(),
        new FakeUndoRedoService() as unknown as UndoRedoStackService,
        new FakeUnitOfWork()
      );

      const commandResult = UpdateRecordCommand.create({
        tableId: tableId.toString(),
        recordId: recordResult.record.id().toString(),
        fields: {
          [textFieldId.toString()]: 'New Title',
          [numberFieldId.toString()]: 200,
        },
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      const { fieldKeyMapping } = result._unsafeUnwrap();

      // fieldKeyMapping should map fieldId -> original input key (which is fieldId)
      expect(fieldKeyMapping.get(textFieldId.toString())).toBe(textFieldId.toString());
      expect(fieldKeyMapping.get(numberFieldId.toString())).toBe(numberFieldId.toString());
    });

    it('returns fieldKeyMapping using fieldName when input uses fieldName', async () => {
      const { table, tableId, textFieldId, numberFieldId } = buildTable();
      const recordResult = table
        .createRecord(
          new Map<string, string | number>([
            [textFieldId.toString(), 'Old Title'],
            [numberFieldId.toString(), 100],
          ])
        )
        ._unsafeUnwrap();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordRepository = new FakeTableRecordRepository();
      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.record = {
        id: recordResult.record.id().toString(),
        version: 1,
        fields: {
          [textFieldId.toString()]: 'Old Title',
          [numberFieldId.toString()]: 100,
        },
      };

      const handler = createHandler(
        tableQueryService,
        recordRepository,
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        createRecordWritePluginRunner(),
        createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
        new FakeEventBus(),
        new FakeUndoRedoService() as unknown as UndoRedoStackService,
        new FakeUnitOfWork()
      );

      // Use fieldName as key instead of fieldId
      const commandResult = UpdateRecordCommand.create({
        tableId: tableId.toString(),
        recordId: recordResult.record.id().toString(),
        fields: {
          Title: 'New Title',
          Amount: 200,
        },
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      const { fieldKeyMapping } = result._unsafeUnwrap();

      // fieldKeyMapping should map fieldId -> original input key (which is fieldName)
      expect(fieldKeyMapping.get(textFieldId.toString())).toBe('Title');
      expect(fieldKeyMapping.get(numberFieldId.toString())).toBe('Amount');
    });

    it('returns error when field key is not found', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const recordResult = table
        .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
        ._unsafeUnwrap();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.record = {
        id: recordResult.record.id().toString(),
        version: 1,
        fields: { [textFieldId.toString()]: 'Old Title' },
      };

      const handler = createHandler(
        tableQueryService,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        createRecordWritePluginRunner(),
        createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
        new FakeEventBus(),
        new FakeUndoRedoService() as unknown as UndoRedoStackService,
        new FakeUnitOfWork()
      );

      const commandResult = UpdateRecordCommand.create({
        tableId: tableId.toString(),
        recordId: recordResult.record.id().toString(),
        fields: {
          Title: 'Valid',
          UnknownField: 'Should fail',
        },
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('field.not_found');
    });
  });
});

describe('UpdateRecordHandler schema coordination', () => {
  const setup = (
    coordination: ITableSchemaCoordination,
    options: {
      failFindOne?: DomainError;
      plugins?: Parameters<typeof createRecordWritePluginRunner>[0];
    } = {}
  ) => {
    const {
      table,
      tableId,
      textFieldId,
      numberFieldId,
      singleSelectFieldId,
      multiSelectFieldId,
      userFieldId,
    } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();
    const recordId = recordResult.record.id().toString();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordId,
      version: 1,
      fields: { [textFieldId.toString()]: 'Old Title' },
    };
    if (options.failFindOne) {
      recordQueryRepository.failFindOne = options.failFindOne;
    }
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();

    const handler = createHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(options.plugins),
      createTableUpdateFlow(tableRepository, eventBus, new FakeUnitOfWork()),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoStackService,
      new FakeUnitOfWork(),
      undefined,
      coordination
    );

    return {
      table,
      tableId,
      textFieldId,
      numberFieldId,
      singleSelectFieldId,
      multiSelectFieldId,
      userFieldId,
      recordId,
      handler,
      recordRepository,
      eventBus,
      recordQueryRepository,
      tableRepository,
    };
  };

  it('holds a shared lease for an ordinary update', async () => {
    const coordination = new RecordingTableSchemaCoordination();
    const { tableId, textFieldId, recordId, handler } = setup(coordination);
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: { [textFieldId.toString()]: 'New Title' },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(coordination.calls).toEqual([{ tableIds: [tableId.toString()], mode: 'shared' }]);
    expect(coordination.releaseCount).toBe(1);
  });

  it('uses the persisted version pair when a concurrent update wins the version race', async () => {
    const coordination = new RecordingTableSchemaCoordination();
    const {
      tableId,
      textFieldId,
      recordId,
      handler,
      eventBus,
      recordRepository,
      recordQueryRepository,
    } = setup(coordination);
    // The pre-transaction read observed v3, while the update statement actually
    // replaced v8 with v9 after another shared-lease update committed.
    recordQueryRepository.record = { ...recordQueryRepository.record!, version: 3 };
    recordRepository.updateSnapshotVersions = { oldVersion: 8, newVersion: 9 };
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: { [textFieldId.toString()]: 'New Title' },
      typecast: true,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    const event = eventBus.published.filter(isRecordUpdatedEvent)[0];
    expect(event?.oldVersion).toBe(8);
    expect(event?.newVersion).toBe(9);
  });

  it('keeps a shared lease for typecast updates that do not change metadata', async () => {
    const coordination = new RecordingTableSchemaCoordination();
    const { tableId, textFieldId, numberFieldId, singleSelectFieldId, recordId, handler } =
      setup(coordination);
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: {
        [textFieldId.toString()]: 'New Title',
        [numberFieldId.toString()]: '42',
        [singleSelectFieldId.toString()]: 'Open',
      },
      typecast: true,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(coordination.calls).toEqual([{ tableIds: [tableId.toString()], mode: 'shared' }]);
    expect(coordination.events).toEqual(['acquire:shared', 'release:shared']);
  });

  it('defers option-creation permission errors to the shared write path', async () => {
    const coordination = new RecordingTableSchemaCoordination();
    const { tableId, singleSelectFieldId, recordId, handler } = setup(coordination);
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: { [singleSelectFieldId.toString()]: 'Closed' },
      typecast: true,
    })._unsafeUnwrap();

    const result = await handler.handle(
      createContext({ allowSelectOptionAutoCreate: false }),
      command
    );

    expect(result._unsafeUnwrapErr().code).toBe(
      'permission.field.update_required_for_select_options'
    );
    expect(coordination.calls).toEqual([{ tableIds: [tableId.toString()], mode: 'shared' }]);
    expect(command.fieldValues.get(singleSelectFieldId.toString())).toBe('Closed');
  });

  it('keeps command values intact when the metadata probe rejects an option', async () => {
    const coordination = new RecordingTableSchemaCoordination();
    const { tableId, textFieldId, singleSelectFieldId, recordId, handler, tableRepository } =
      setup(coordination);
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: {
        [textFieldId.toString()]: 'New Title',
        [singleSelectFieldId.toString()]: 'TooLongName',
      },
      typecast: true,
    })._unsafeUnwrap();

    const result = await handler.handle(
      createContext({ tableLimits: { fieldOptions: { maxSelectChoiceNameLength: 4 } } }),
      command
    );

    expect(result.isOk()).toBe(true);
    expect(coordination.calls).toEqual([{ tableIds: [tableId.toString()], mode: 'shared' }]);
    expect(command.fieldValues.get(singleSelectFieldId.toString())).toBe('TooLongName');
    expect(tableRepository.updated).toHaveLength(0);
  });

  it('releases the shared lease before acquiring exclusive for a new select option', async () => {
    const coordination = new RecordingTableSchemaCoordination();
    const { tableId, singleSelectFieldId, recordId, handler, tableRepository } =
      setup(coordination);
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: { [singleSelectFieldId.toString()]: 'Closed' },
      typecast: true,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(coordination.calls).toEqual([
      { tableIds: [tableId.toString()], mode: 'shared' },
      { tableIds: [tableId.toString()], mode: 'exclusive' },
    ]);
    expect(coordination.events).toEqual([
      'acquire:shared',
      'release:shared',
      'acquire:exclusive',
      'release:exclusive',
    ]);
    expect(tableRepository.updated).toHaveLength(1);
    const statusField = tableRepository.updated[0]!.getField((field) =>
      field.id().equals(singleSelectFieldId)
    )._unsafeUnwrap() as SingleSelectField;
    expect(statusField.selectOptions().map((option) => option.name().toString())).toEqual([
      'Open',
      'Closed',
    ]);
  });

  it('reloads table metadata after the lease gap and keeps a concurrent option', async () => {
    const coordination = new RecordingTableSchemaCoordination();
    const { table, tableId, singleSelectFieldId, recordId, handler, tableRepository } =
      setup(coordination);
    const tableWithClosedOption = table
      .update((mutator) =>
        mutator.addSelectOptions(singleSelectFieldId, [
          SelectOption.create({ name: 'Closed', color: 'red' })._unsafeUnwrap(),
        ])
      )
      ._unsafeUnwrap().table;
    // Another writer created the option while this command held only the shared
    // lease. The exclusive attempt must see it instead of persisting its own.
    coordination.onAcquire = (mode) => {
      if (mode === 'exclusive') {
        tableRepository.tables = [tableWithClosedOption];
      }
    };
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: { [singleSelectFieldId.toString()]: 'Closed' },
      typecast: true,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(coordination.events).toEqual([
      'acquire:shared',
      'release:shared',
      'acquire:exclusive',
      'release:exclusive',
    ]);
    expect(tableRepository.updated).toHaveLength(0);
    const statusField = tableRepository.tables[0]!.getField((field) =>
      field.id().equals(singleSelectFieldId)
    )._unsafeUnwrap() as SingleSelectField;
    expect(statusField.selectOptions().map((option) => option.name().toString())).toEqual([
      'Open',
      'Closed',
    ]);
  });

  it('reports field.not_found when the field is deleted during the lease gap', async () => {
    const coordination = new RecordingTableSchemaCoordination();
    const { table, tableId, singleSelectFieldId, recordId, handler, tableRepository } =
      setup(coordination);
    const tableWithoutStatus = table.removeField(singleSelectFieldId)._unsafeUnwrap();
    coordination.onAcquire = (mode) => {
      if (mode === 'exclusive') {
        tableRepository.tables = [tableWithoutStatus];
      }
    };
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: { [singleSelectFieldId.toString()]: 'Closed' },
      typecast: true,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrapErr().code).toBe('field.not_found');
    expect(coordination.releaseCount).toBe(2);
    expect(tableRepository.updated).toHaveLength(0);
  });

  it('releases the shared lease when the exclusive acquisition fails', async () => {
    const acquireError = domainError.infrastructure({
      code: 'schema_coordination.acquire_failed',
      message: 'Failed to acquire table schema coordination locks',
    });
    const coordination = new RecordingTableSchemaCoordination(acquireError);
    coordination.failMode = 'exclusive';
    const { tableId, singleSelectFieldId, recordId, handler } = setup(coordination);
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: { [singleSelectFieldId.toString()]: 'Closed' },
      typecast: true,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrapErr().code).toBe('schema_coordination.acquire_failed');
    expect(coordination.events).toEqual(['acquire:shared', 'release:shared', 'acquire:exclusive']);
    expect(coordination.releaseCount).toBe(1);
  });

  it('runs plugin prepare and guard once while upgrading to the exclusive lease', async () => {
    const tracked = createTrackedRecordWritePlugin([RecordWriteOperationKind.updateOne]);
    const coordination = new RecordingTableSchemaCoordination();
    const { tableId, singleSelectFieldId, recordId, handler } = setup(coordination, {
      plugins: [tracked.plugin],
    });
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: { [singleSelectFieldId.toString()]: 'Closed' },
      typecast: true,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(coordination.calls.map((call) => call.mode)).toEqual(['shared', 'exclusive']);
    expect(tracked.calls.prepare).toHaveLength(1);
    expect(tracked.calls.guard).toHaveLength(1);
  });

  it('does not coordinate ordered updates because row-order CIC cannot run inside the lease', async () => {
    const coordination = new RecordingTableSchemaCoordination();
    const { table, tableId, textFieldId, recordId, handler } = setup(coordination);
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: { [textFieldId.toString()]: 'New Title' },
      order: {
        viewId: table.views()[0]!.id().toString(),
        anchorId: recordId,
        position: 'after',
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(coordination.calls).toEqual([]);
    expect(coordination.releaseCount).toBe(0);
  });

  it('returns the coordination failure before reading table metadata', async () => {
    const acquireError = domainError.infrastructure({
      code: 'schema_coordination.acquire_failed',
      message: 'Failed to acquire table schema coordination locks',
    });
    const coordination = new RecordingTableSchemaCoordination(acquireError);
    const { tableId, textFieldId, recordId, handler, recordQueryRepository } = setup(coordination);
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: { [textFieldId.toString()]: 'New Title' },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrapErr().code).toBe('schema_coordination.acquire_failed');
    expect(recordQueryRepository.findOneCalls).toBe(0);
    expect(coordination.releaseCount).toBe(0);
  });

  it('releases the lease when the update fails', async () => {
    const coordination = new RecordingTableSchemaCoordination();
    const { tableId, textFieldId, recordId, handler } = setup(coordination, {
      failFindOne: domainError.notFound({ message: 'Record not found' }),
    });
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: { [textFieldId.toString()]: 'New Title' },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(coordination.releaseCount).toBe(1);
  });
});

describe('UpdateRecordHandler order-only updates', () => {
  const setup = () => {
    const { table, tableId, textFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Title']]))
      ._unsafeUnwrap();
    const recordId = recordResult.record.id().toString();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordId,
      version: 1,
      fields: { [textFieldId.toString()]: 'Title' },
      autoNumber: 1,
    };
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const undoRedoService = new FakeUndoRedoService();

    const handler = createHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      undoRedoService as unknown as UndoRedoStackService,
      unitOfWork
    );

    return {
      table,
      tableId,
      textFieldId,
      recordId,
      handler,
      recordRepository,
      eventBus,
      undoRedoService,
    };
  };

  it('persists the row order without a field mutation when fields are empty', async () => {
    const {
      table,
      tableId,
      textFieldId,
      recordId,
      handler,
      recordRepository,
      eventBus,
      undoRedoService,
    } = setup();
    const viewId = table.views()[0]!.id();
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: {},
      order: { viewId: viewId.toString(), anchorId: recordId, position: 'after' },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    const payload = result._unsafeUnwrap();
    expect(payload.record.fields().get(textFieldId)?.toValue()).toBe('Title');
    expect(recordRepository.lastMutateSpec).toBeUndefined();
    expect(recordRepository.streamedUpdates).toHaveLength(1);
    const orderSpec = recordRepository.streamedUpdates[0]!.mutateSpec;
    expect(orderSpec).toBeInstanceOf(SetRowOrderValueSpec);
    expect((orderSpec as SetRowOrderValueSpec).orderValue).toBe(1024);
    expect(eventBus.published.some(isRecordUpdatedEvent)).toBe(false);
    const reordered = eventBus.published.filter(
      (event): event is RecordReordered => event instanceof RecordReordered
    );
    expect(reordered).toHaveLength(1);
    expect(reordered[0]!.ordersByRecordId).toEqual({ [recordId]: 1024 });
    expect(reordered[0]!.previousOrdersByRecordId).toEqual({ [recordId]: 1 });
    expect(undoRedoService.calls).toHaveLength(0);
    expect(undoRedoService.entryCalls).toHaveLength(1);
  });

  it('still rejects an update with neither field values nor order', async () => {
    const { tableId, recordId, handler, recordRepository, eventBus } = setup();
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId,
      fields: {},
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrapErr().message).toBe('No field values to set');
    expect(recordRepository.lastMutateSpec).toBeUndefined();
    expect(recordRepository.streamedUpdates).toHaveLength(0);
    expect(eventBus.published).toHaveLength(0);
  });
});
