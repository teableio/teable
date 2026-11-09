import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { AttachmentValueResolverService } from '../application/services/AttachmentValueResolverService';
import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { LinkTitleResolverService } from '../application/services/LinkTitleResolverService';
import type { IRecordChangedValueDecoratorService } from '../application/services/RecordChangedValueDecoratorService';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { TableCreationService } from '../application/services/TableCreationService';
import { createDefaultTableDataSafetyLimitComposer } from '../application/services/TableDataSafetyLimitComposer';
import { TableDataSafetyLimitTableOperationPlugin } from '../application/services/TableDataSafetyLimitTableOperationPlugin';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { UserValueResolverService } from '../application/services/UserValueResolverService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { isRecordCreatedEvent } from '../domain/table/events/RecordCreated';
import { isRecordsBatchCreatedEvent } from '../domain/table/events/RecordsBatchCreated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
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
import { NoopTableRecordQueryRepository } from '../ports/defaults/NoopTableRecordQueryRepository';
import type { IEventBus } from '../ports/EventBus';
import type {
  IExecutionContext,
  IUnitOfWorkTransaction,
  UnitOfWorkScope,
} from '../ports/ExecutionContext';
import { FieldOperationKind } from '../ports/FieldOperationPlugin';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  BatchRecordMutationResult,
  ITableRecordRepository,
  InsertManyStreamOptions,
  InsertManyStreamResult,
  InsertOptions,
  RecordMutationResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository, TableProvisionState } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { CreateTablesCommand } from './CreateTablesCommand';
import { CreateTablesHandler } from './CreateTablesHandler';
import {
  createFieldOperationPluginRunner,
  createTrackedFieldOperationPlugin,
} from './fieldOperationPluginRunnerTestUtils';
import { createTableOperationPluginRunner } from './tableOperationPluginRunnerTestUtils';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  actorIdResult._unsafeUnwrap();
  return { actorId: actorIdResult._unsafeUnwrap() };
};

const createTableLimitPluginRunner = (tableRepository: ITableRepository) =>
  createTableOperationPluginRunner([
    new TableDataSafetyLimitTableOperationPlugin(
      tableRepository,
      createDefaultTableDataSafetyLimitComposer()
    ),
  ]);

const createRecordMutationSpecResolver = (tableRepository: ITableRepository) =>
  new RecordMutationSpecResolverService(
    new LinkTitleResolverService(tableRepository, new NoopTableRecordQueryRepository()),
    new AttachmentValueResolverService({
      listAttachmentsByTokens: async () => ok([]),
      listAttachmentsByAttachmentIds: async () => ok([]),
    }),
    new UserValueResolverService({
      listTableUsersByIdentifiers: async () => ok([]),
      listUsersByIdentityPairs: async () => ok([]),
      listUsersByIds: async () => ok([]),
    })
  );

const buildTable = (params: {
  baseId: string;
  tableId: string;
  tableName: string;
  primaryFieldId: string;
}): Table => {
  return Table.builder()
    .withId(TableId.create(params.tableId)._unsafeUnwrap())
    .withBaseId(BaseId.create(params.baseId)._unsafeUnwrap())
    .withName(TableName.create(params.tableName)._unsafeUnwrap())
    .field()
    .singleLineText()
    .withId(FieldId.create(params.primaryFieldId)._unsafeUnwrap())
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done()
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();
};

class FakeTableRepository implements ITableRepository {
  inserted: Table[] = [];
  updated: Table[] = [];
  provisionStateChanges: Array<{ tableId: string; state: TableProvisionState }> = [];
  failFind: DomainError | undefined;

  async insert(_context: IExecutionContext, table: Table) {
    this.inserted.push(table);
    return ok(table);
  }

  async insertMany(_context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.inserted.push(...tables);
    return ok([...tables]);
  }

  async duplicatePhysicalRows(
    _context: any,
    _plan: any
  ): Promise<Result<{ rowCount: number; recordIds: string[] }, DomainError>> {
    return ok({ rowCount: 0, recordIds: [] });
  }

  async findOne(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    if (this.failFind) return err(this.failFind);
    const match = this.inserted.find((table) => spec.isSatisfiedBy(table));
    if (!match) return err(domainError.notFound({ message: 'Not found' }));
    return ok(match);
  }

  async find(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    if (this.failFind) return err(this.failFind);
    return ok(this.inserted.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const index = this.inserted.findIndex((entry) => entry.id().equals(table.id()));
    if (index === -1) return err(domainError.notFound({ message: 'Not found' }));
    this.inserted[index] = table;
    this.updated.push(table);
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async setProvisionStateMany(
    _context: IExecutionContext,
    tables: ReadonlyArray<Table>,
    state: TableProvisionState
  ): Promise<Result<void, DomainError>> {
    for (const table of tables) {
      this.provisionStateChanges.push({ tableId: table.id().toString(), state });
    }
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  inserted: Table[] = [];

  async insert(_context: IExecutionContext, table: Table) {
    this.inserted.push(table);
    return ok(undefined);
  }

  async insertMany(_context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.inserted.push(...tables);
    return ok(undefined);
  }

  async update(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ) {
    return ok(table);
  }

  async delete(_context: IExecutionContext, _table: Table) {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  insertedCount = 0;
  insertedTableIds: string[] = [];
  insertedRecordsByTable = new Map<string, TableRecord[]>();
  insertOptions: InsertOptions[] = [];
  insertManyResultFactory?: (
    table: Table,
    records: ReadonlyArray<TableRecord>
  ) => BatchRecordMutationResult;

  async insert(
    _context: IExecutionContext,
    _table: Table,
    _record: TableRecord
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertMany(
    _context: IExecutionContext,
    table: Table,
    records: ReadonlyArray<TableRecord>,
    options?: InsertOptions
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    const tableId = table.id().toString();
    this.insertedTableIds.push(tableId);
    if (options) {
      this.insertOptions.push(options);
    }
    this.insertedCount += records.length;
    const existing = this.insertedRecordsByTable.get(tableId) ?? [];
    this.insertedRecordsByTable.set(tableId, [...existing, ...records]);
    return ok(this.insertManyResultFactory?.(table, records) ?? {});
  }

  async insertManyStream(
    _context: IExecutionContext,
    _table: Table,
    batches: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>,
    options?: InsertManyStreamOptions
  ) {
    let totalInserted = 0;
    let batchIndex = 0;
    for await (const batch of batches as AsyncIterable<ReadonlyArray<TableRecord>>) {
      totalInserted += batch.length;
      options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
      batchIndex += 1;
    }
    const result: InsertManyStreamResult = { totalInserted };
    this.insertedCount += totalInserted;
    return ok(result);
  }

  async updateOne(
    _context: IExecutionContext,
    _table: Table,
    _recordId: RecordId,
    _mutateSpec: ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async updateMany(
    _context: IExecutionContext,
    _table: Table,
    _spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _mutateSpec: ICellValueSpec
  ) {
    return ok({ totalUpdated: 0, updatedRecordIds: [], updatedRecords: [] });
  }

  async updateManyStream(
    _context: IExecutionContext,
    _table: Table,
    _batches: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<{ totalUpdated: number; updatedRecords: [] }, DomainError>> {
    return ok({ totalUpdated: 0, updatedRecords: [] });
  }

  async deleteMany(
    _context: IExecutionContext,
    _table: Table,
    _spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ) {
    return ok({});
  }

  async deleteManyStream() {
    return ok({ totalDeleted: 0 });
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];

  async publish(_context: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(_context: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    this.published.push(...events);
    return ok(undefined);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    const scope: UnitOfWorkScope = options?.scope ?? 'data';
    const existing = context.transactions?.[scope];
    if (existing) {
      return work({ ...context, transaction: existing });
    }
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction', scope };
    const transactionContext = {
      ...context,
      transaction,
      transactions: {
        ...(context.transactions ?? {}),
        [scope]: transaction,
      },
    };
    return work(transactionContext);
  }
}

describe('CreateTablesHandler', () => {
  it('creates tables with internal link references', async () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const tableAId = `tbl${'a'.repeat(16)}`;
    const tableBId = `tbl${'b'.repeat(16)}`;
    const tableBPrimaryId = `fld${'b'.repeat(16)}`;

    const commandResult = CreateTablesCommand.create({
      baseId,
      tables: [
        {
          tableId: tableAId,
          name: 'Table A',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'link',
              name: 'Link to B',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableBId,
                lookupFieldId: tableBPrimaryId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        },
        {
          tableId: tableBId,
          name: 'Table B',
          fields: [{ type: 'singleLineText', id: tableBPrimaryId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        },
      ],
    });

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const tableCreationService = new TableCreationService(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectService
    );

    const { plugin, calls } = createTrackedFieldOperationPlugin([FieldOperationKind.create]);
    const handler = new CreateTablesHandler(
      tableRepository,
      recordRepository,
      foreignTableLoaderService,
      tableCreationService,
      eventBus,
      unitOfWork,
      createRecordMutationSpecResolver(tableRepository),
      undefined,
      createTableLimitPluginRunner(tableRepository),
      createFieldOperationPluginRunner([plugin])
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(tableRepository.inserted).toHaveLength(2);
    expect(schemaRepository.inserted).toHaveLength(2);
    expect(tableRepository.updated).toHaveLength(1);
    expect(tableRepository.provisionStateChanges.map(({ state }) => state)).toEqual([
      'pending',
      'pending',
      'ready',
      'ready',
    ]);
    expect(calls.prepare).toHaveLength(1);
    expect(calls.guard).toHaveLength(1);
    expect(calls.beforePersist).toHaveLength(1);
    expect(calls.afterCommit).toHaveLength(1);
    expect(calls.prepare[0]?.target.kind).toBe('sideEffect');
    expect(calls.prepare[0]?.table.id().toString()).toBe(tableBId);
  });

  it('publishes decorated persisted and computed values in per-table creation events', async () => {
    const baseId = `bse${'c'.repeat(16)}`;
    const firstTableId = `tbl${'c'.repeat(16)}`;
    const secondTableId = `tbl${'d'.repeat(16)}`;
    const firstFieldId = `fld${'c'.repeat(16)}`;
    const secondFieldId = `fld${'d'.repeat(16)}`;
    const unchangedFieldId = `fld${'u'.repeat(16)}`;
    const computedFieldId = `fld${'f'.repeat(16)}`;

    const commandResult = CreateTablesCommand.create({
      baseId,
      tables: [
        {
          tableId: firstTableId,
          name: 'Table One',
          fields: [
            { type: 'singleLineText', id: firstFieldId, name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: unchangedFieldId, name: 'Note' },
          ],
          views: [{ type: 'grid' }],
          records: [{ fields: { [firstFieldId]: 'Alpha', [unchangedFieldId]: 'Keep me' } }],
        },
        {
          tableId: secondTableId,
          name: 'Table Two',
          fields: [
            { type: 'singleLineText', id: secondFieldId, name: 'Name', isPrimary: true },
            {
              type: 'formula',
              id: computedFieldId,
              name: 'Computed',
              options: { expression: `{${secondFieldId}}` },
            },
          ],
          views: [{ type: 'grid' }],
          records: [
            { fields: { [secondFieldId]: 'Beta' } },
            { fields: { [secondFieldId]: 'Gamma' } },
          ],
        },
      ],
    });

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
    recordRepository.insertManyResultFactory = (table, records) => {
      const titleFieldId = table.id().toString() === firstTableId ? firstFieldId : secondFieldId;
      const viewId = table.views()[0]!.id().toString();
      return {
        changedFieldsByRecord: new Map(
          records.map((record, index) => [
            record.id().toString(),
            new Map([[titleFieldId, `persisted-${index}`]]),
          ])
        ),
        computedChangesByRecord:
          table.id().toString() === secondTableId
            ? new Map(
                records.map((record, index) => [
                  record.id().toString(),
                  new Map([[computedFieldId, index * 2]]),
                ])
              )
            : undefined,
        recordOrders: new Map(
          records.map((record, index) => [record.id().toString(), { [viewId]: index + 1 }])
        ),
      };
    };
    const decorator: IRecordChangedValueDecoratorService = {
      async decorateChangedFields(_table, changedFields) {
        return ok(changedFields);
      },
      async decorateChangedFieldsByRecord(table, changedFieldsByRecord) {
        return ok(
          new Map(
            [...(changedFieldsByRecord ?? [])].map(([recordId, changedFields]) => [
              recordId,
              new Map(
                [...changedFields].map(([fieldId, value]) => [
                  fieldId,
                  `decorated:${table.name().toString()}:${String(value)}`,
                ])
              ),
            ])
          )
        );
      },
    };
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const tableCreationService = new TableCreationService(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectService
    );

    const handler = new CreateTablesHandler(
      tableRepository,
      recordRepository,
      foreignTableLoaderService,
      tableCreationService,
      eventBus,
      unitOfWork,
      createRecordMutationSpecResolver(tableRepository),
      undefined,
      createTableLimitPluginRunner(tableRepository),
      undefined,
      decorator
    );

    const result = await handler.handle(
      { ...createContext(), requestId: 'initial-records-op' },
      commandResult._unsafeUnwrap()
    );
    const created = result._unsafeUnwrap();

    expect(recordRepository.insertedCount).toBe(3);
    expect(recordRepository.insertOptions).toHaveLength(2);
    expect(recordRepository.insertOptions).toEqual([
      expect.objectContaining({ allowPendingTableProvisionForComputedUpdates: true }),
      expect.objectContaining({ allowPendingTableProvisionForComputedUpdates: true }),
    ]);
    const singleEvents = created.events.filter(isRecordCreatedEvent);
    expect(singleEvents).toHaveLength(1);
    expect(singleEvents[0]?.tableId.toString()).toBe(firstTableId);
    expect(singleEvents[0]?.fieldValues).toEqual([
      { fieldId: firstFieldId, value: 'decorated:Table One:persisted-0' },
      { fieldId: unchangedFieldId, value: 'Keep me' },
    ]);
    expect(singleEvents[0]?.source).toEqual({ type: 'user' });

    const batchEvents = created.events.filter(isRecordsBatchCreatedEvent);
    const secondTable = created.tables.find((table) => table.id().toString() === secondTableId)!;
    const viewId = secondTable.views()[0]!.id().toString();
    expect(batchEvents).toHaveLength(1);
    expect(batchEvents[0]?.tableId.toString()).toBe(secondTableId);
    expect(batchEvents[0]?.records).toEqual(
      recordRepository.insertedRecordsByTable.get(secondTableId)!.map((record, index) => ({
        recordId: record.id().toString(),
        fields: [
          { fieldId: secondFieldId, value: `decorated:Table Two:persisted-${index}` },
          { fieldId: computedFieldId, value: index * 2 },
        ],
        orders: { [viewId]: index + 1 },
      }))
    );
    expect(batchEvents[0]?.source).toEqual({ type: 'user' });
    expect(batchEvents[0]?.orchestration).toEqual({
      operationId: 'initial-records-op',
      groupId: 'initial-records-op',
      totalRecordCount: 2,
      totalChunkCount: 1,
      chunkIndex: 0,
      scope: 'operation',
    });
    const secondTableInsertIndex = recordRepository.insertedTableIds.indexOf(secondTableId);
    expect(secondTableInsertIndex).toBeGreaterThanOrEqual(0);
    expect(recordRepository.insertOptions[secondTableInsertIndex]?.orchestration).toEqual(
      batchEvents[0]?.orchestration
    );
    expect(created.events[0]?.name.toString()).toBe('TableCreated');
    expect(created.events.filter((event) => event.name.toString() === 'TableCreated')).toHaveLength(
      2
    );
    expect(eventBus.published).toEqual(created.events);
  });

  it('rejects missing not-null record values before starting table.create_many', async () => {
    const requiredFieldId = `fld${'z'.repeat(16)}`;
    const commandResult = CreateTablesCommand.create({
      baseId: `bse${'z'.repeat(16)}`,
      tables: [
        {
          name: 'Required Records',
          fields: [
            { type: 'singleLineText', name: 'Title', isPrimary: true },
            {
              type: 'singleLineText',
              id: requiredFieldId,
              name: 'Required Code',
              notNull: true,
            },
          ],
          views: [{ type: 'grid' }],
          records: [{ fields: { Title: 'Row 1' } }],
        },
      ],
    });

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const tableCreationService = new TableCreationService(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectService
    );
    const handler = new CreateTablesHandler(
      tableRepository,
      recordRepository,
      foreignTableLoaderService,
      tableCreationService,
      eventBus,
      unitOfWork,
      createRecordMutationSpecResolver(tableRepository),
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.field.not_null',
    });
    expect(tableRepository.inserted).toHaveLength(0);
    expect(schemaRepository.inserted).toHaveLength(0);
    expect(recordRepository.insertedCount).toBe(0);
    expect(tableRepository.provisionStateChanges).toHaveLength(0);
  });

  it('keeps record insertion mapped to input order', async () => {
    const baseId = `bse${'e'.repeat(16)}`;
    const tableAId = `tbl${'a'.repeat(16)}`;
    const tableBId = `tbl${'b'.repeat(16)}`;
    const tableAPrimaryId = `fld${'a'.repeat(16)}`;
    const tableBPrimaryId = `fld${'b'.repeat(16)}`;
    const tableALinkId = `fld${'c'.repeat(16)}`;

    const commandResult = CreateTablesCommand.create({
      baseId,
      tables: [
        {
          tableId: tableAId,
          name: 'Table A',
          fields: [
            { type: 'singleLineText', id: tableAPrimaryId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: tableALinkId,
              name: 'Link to B',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableBId,
                lookupFieldId: tableBPrimaryId,
              },
            },
          ],
          views: [{ type: 'grid' }],
          records: [{ fields: { [tableAPrimaryId]: 'Alpha' } }],
        },
        {
          tableId: tableBId,
          name: 'Table B',
          fields: [{ type: 'singleLineText', id: tableBPrimaryId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
          records: [{ fields: { [tableBPrimaryId]: 'Beta' } }],
        },
      ],
    });

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const tableCreationService = new TableCreationService(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectService
    );

    const handler = new CreateTablesHandler(
      tableRepository,
      recordRepository,
      foreignTableLoaderService,
      tableCreationService,
      eventBus,
      unitOfWork,
      createRecordMutationSpecResolver(tableRepository),
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    const recordsA = recordRepository.insertedRecordsByTable.get(tableAId) ?? [];
    const recordsB = recordRepository.insertedRecordsByTable.get(tableBId) ?? [];

    expect(recordsA).toHaveLength(1);
    expect(recordsB).toHaveLength(1);

    const recordAValue = recordsA[0]
      ?.fields()
      .entries()
      .find((entry) => entry.fieldId.toString() === tableAPrimaryId)
      ?.value.toValue();
    const recordBValue = recordsB[0]
      ?.fields()
      .entries()
      .find((entry) => entry.fieldId.toString() === tableBPrimaryId)
      ?.value.toValue();

    expect(recordAValue).toBe('Alpha');
    expect(recordBValue).toBe('Beta');
  });

  it('allows creating tables that link to external cross-base tables', async () => {
    const hostBaseId = `bse${'f'.repeat(16)}`;
    const foreignBaseId = `bse${'g'.repeat(16)}`;
    const foreignTableId = `tbl${'h'.repeat(16)}`;
    const foreignPrimaryId = `fld${'i'.repeat(16)}`;
    const hostTableId = `tbl${'j'.repeat(16)}`;
    const hostPrimaryId = `fld${'k'.repeat(16)}`;
    const hostLinkId = `fld${'l'.repeat(16)}`;

    const commandResult = CreateTablesCommand.create({
      baseId: hostBaseId,
      tables: [
        {
          tableId: hostTableId,
          name: 'Host Table',
          fields: [
            { type: 'singleLineText', id: hostPrimaryId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: hostLinkId,
              name: 'Cross Base Link',
              options: {
                baseId: foreignBaseId,
                relationship: 'manyOne',
                foreignTableId,
                lookupFieldId: foreignPrimaryId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        },
      ],
    });

    const tableRepository = new FakeTableRepository();
    tableRepository.inserted.push(
      buildTable({
        baseId: foreignBaseId,
        tableId: foreignTableId,
        tableName: 'Foreign Table',
        primaryFieldId: foreignPrimaryId,
      })
    );
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const tableCreationService = new TableCreationService(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectService
    );
    const handler = new CreateTablesHandler(
      tableRepository,
      recordRepository,
      foreignTableLoaderService,
      tableCreationService,
      eventBus,
      unitOfWork,
      createRecordMutationSpecResolver(tableRepository),
      undefined,
      createTableLimitPluginRunner(tableRepository)
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(tableRepository.inserted.some((table) => table.id().toString() === hostTableId)).toBe(
      true
    );
  });
});
