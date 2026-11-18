import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { AttachmentValueResolverService } from '../application/services/AttachmentValueResolverService';
import { LinkTitleResolverService } from '../application/services/LinkTitleResolverService';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import type { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { UserValueResolverService } from '../application/services/UserValueResolverService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, isDomainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldOptionsAdded } from '../domain/table/events/FieldOptionsAdded';
import { isRecordsBatchCreatedEvent } from '../domain/table/events/RecordsBatchCreated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { FieldNotNull } from '../domain/table/fields/types/FieldNotNull';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { UserDefaultValue } from '../domain/table/fields/types/UserDefaultValue';
import { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import { SetSingleLineTextValueSpec } from '../domain/table/records/specs/values/SetSingleLineTextValueSpec';
import { TableRecord } from '../domain/table/records/TableRecord';
import { CellValue } from '../domain/table/records/values/CellValue';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type {
  IImportParseResult,
  IImportOptions,
  IImportSource,
  IImportProgress,
} from '../ports/import/IImportSource';
import type { IImportSourceAdapter } from '../ports/import/IImportSourceAdapter';
import type { IImportSourceRegistry } from '../ports/import/IImportSourceRegistry';
import { EventBusDomainWriteTransaction } from '../ports/memory/EventBusDomainWriteTransaction';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  BatchRecordMutationResult,
  InsertManyStreamOptions,
  ITableRecordRepository,
  RecordMutationResult,
  UpdateManyStreamResult,
} from '../ports/TableRecordRepository';
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import type { IUserLookupService } from '../ports/UserLookupService';
import { ImportRecordsCommand } from './ImportRecordsCommand';
import { ImportRecordsHandler } from './ImportRecordsHandler';
import {
  createRecordWritePluginRunner,
  createTrackedRecordWritePlugin,
} from './recordWritePluginRunnerTestUtils';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'i'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'j'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Import Test')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    textFieldId,
  };
};

const isAsyncIterable = <T>(value: Iterable<T> | AsyncIterable<T>): value is AsyncIterable<T> =>
  typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function';

class FakeImportSourceAdapter implements IImportSourceAdapter {
  readonly supportedTypes = ['csv'];
  parseCalls: Array<{ source: IImportSource; options?: IImportOptions }> = [];

  constructor(private readonly result: Result<IImportParseResult, DomainError>) {}

  supports(type: string): boolean {
    return this.supportedTypes.includes(type);
  }

  async parse(
    source: IImportSource,
    options?: IImportOptions
  ): Promise<Result<IImportParseResult, DomainError>> {
    this.parseCalls.push({ source, options });
    return this.result;
  }
}

class FakeImportSourceRegistry implements IImportSourceRegistry {
  constructor(private readonly adapter: IImportSourceAdapter) {}

  register(_: IImportSourceAdapter): void {
    return undefined;
  }

  getAdapter(_: string): Result<IImportSourceAdapter, DomainError> {
    return ok(this.adapter);
  }

  getSupportedTypes(): ReadonlyArray<string> {
    return this.adapter.supportedTypes;
  }

  supports(type: string): boolean {
    return this.adapter.supports(type);
  }
}

class FakeTableRepository implements ITableRepository {
  constructor(private readonly tables: Table[]) {}

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(tables);
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
    const table = this.tables.find((candidate) => spec.isSatisfiedBy(candidate));
    if (!table) {
      return err(domainError.notFound({ message: 'Table not found' }));
    }
    return ok(table);
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
  inserted: TableRecord[] = [];
  insertedBatches: TableRecord[][] = [];
  insertManyStreamOptions: InsertManyStreamOptions | undefined;

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
    batches: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>,
    options?: InsertManyStreamOptions
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    this.insertManyStreamOptions = options;
    let totalInserted = 0;
    let batchIndex = 0;

    try {
      if (isAsyncIterable(batches)) {
        for await (const batch of batches) {
          this.insertedBatches.push([...batch]);
          this.inserted.push(...batch);
          totalInserted += batch.length;
          options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
          batchIndex += 1;
        }
      } else {
        for (const batch of batches) {
          this.insertedBatches.push([...batch]);
          this.inserted.push(...batch);
          totalInserted += batch.length;
          options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
          batchIndex += 1;
        }
      }
    } catch (error) {
      if (isDomainError(error)) {
        return err(error);
      }
      throw error;
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
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return ok({ totalUpdated: 0, updatedRecordIds: [], updatedRecords: [] });
  }

  async updateManyStream(
    _: IExecutionContext,
    __: Table,
    ___: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
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

class FakeEventBus implements IEventBus {
  publishedMany: ReadonlyArray<IDomainEvent>[] = [];

  async publish(_: IExecutionContext, __: IDomainEvent): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async publishMany(
    _: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    this.publishedMany.push(events);
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

const createCommand = (
  tableId: string,
  textFieldId: string,
  rows = 'Title\nImported row',
  options: Partial<NonNullable<Parameters<typeof ImportRecordsCommand.create>[0]['options']>> = {}
) =>
  ImportRecordsCommand.create({
    tableId,
    source: {
      type: 'csv',
      data: rows,
    },
    sourceColumnMap: {
      [textFieldId]: 0,
    },
    options: {
      batchSize: 1,
      skipFirstNLines: 0,
      typecast: false,
      ...options,
    },
  })._unsafeUnwrap();

describe('ImportRecordsHandler', () => {
  it.each([false, true])('reports bad dates and preserves the tail with required=%s', async (required) => {
    const baseId = BaseId.create(`bse${'v'.repeat(16)}`)._unsafeUnwrap();
    const dateFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const titleFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap())
      .withBaseId(baseId)
      .withName(TableName.create('Date diagnostics')._unsafeUnwrap());
    builder.field().singleLineText().withId(titleFieldId)
      .withName(FieldName.create('Title')._unsafeUnwrap()).primary().done();
    const dateBuilder = builder.field().date().withId(dateFieldId)
      .withName(FieldName.create('Date')._unsafeUnwrap());
    if (required) dateBuilder.withNotNull(FieldNotNull.required());
    dateBuilder.done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    if (required) {
      const strict = table.createRecords([new Map([[titleFieldId.toString(), 'missing date']])]);
      expect(strict.isErr()).toBe(true);
      expect(strict._unsafeUnwrapErr().code).toBe('validation.field.not_null');
    }
    const dataRows = Array.from({ length: 605 }, (_, index) => [
      `row ${index}`,
      index < 104 || index === 500
        ? index % 2 === 0 ? '+010000-01-01T00:00:00.000Z' : 'private-bad-date'
        : '2025-04-01',
    ]);
    const adapter = new FakeImportSourceAdapter(ok({
      headers: ['Title', 'Date'],
      rows: [['Title', 'Date'], ...dataRows],
    }));
    const repository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const progress: IImportProgress[] = [];
    const chunkSizes: number[] = [];
    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter), new FakeTableRepository([table]), repository,
      { resolveCreatedRecords: async (...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>) => ok(input) } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner([{
        name: 'accepted-row-observer',
        supports: (operation) => operation === RecordWriteOperationKind.importAppend,
        guard: async (context) => {
          if (context.kind === RecordWriteOperationKind.importAppend) {
            chunkSizes.push(context.payload.recordsFieldValues.length);
          }
          return ok(undefined);
        },
      }]),
      { execute: () => ok({ table, updateResult: undefined }) } as unknown as RecordWriteSideEffectService,
      { execute: async () => ok({ table, events: [] }) } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), eventBus)
    );
    const command = ImportRecordsCommand.create({
      tableId: table.id().toString(), source: { type: 'csv', data: 'ignored' },
      sourceColumnMap: { [titleFieldId.toString()]: 0, [dateFieldId.toString()]: 1 },
      options: { batchSize: 500, typecast: true, skipFirstNLines: 1, onProgress: (value) => progress.push(value) },
    })._unsafeUnwrap();

    const result = (await handler.handle(createContext(), command))._unsafeUnwrap();
    expect(result.totalImported).toBe(required ? 500 : 605);
    expect(result.diagnostics).toMatchObject({ invalidDateCells: 105, skippedRows: required ? 105 : 0 });
    expect(result.diagnostics!.samples).toHaveLength(100);
    expect(result.diagnostics!.samples[0]).toMatchObject({ rowNumber: 2, fieldId: dateFieldId.toString(), reason: 'invalidDate' });
    expect(JSON.stringify(result.diagnostics)).not.toContain('+010000');
    expect(JSON.stringify(result.diagnostics)).not.toContain('private-bad-date');
    expect(repository.inserted.at(-1)!.fields().get(titleFieldId)?.toValue()).toBe('row 604');
    expect(repository.inserted[0]!.fields().get(dateFieldId)?.toValue()).toBe(required ? '2025-04-01T00:00:00.000Z' : null);
    expect(progress.filter((value) => value.phase !== 'completed').every((value) => value.diagnostics === undefined)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ phase: 'completed', processedRows: result.totalImported, diagnostics: result.diagnostics });
    expect(chunkSizes.slice(1)).toEqual(required ? [396, 104] : [500, 105]);
    const batchEvents = eventBus.publishedMany.flat().filter(isRecordsBatchCreatedEvent);
    expect(batchEvents.reduce((total, event) => total + event.records.length, 0)).toBe(result.totalImported);
  });

  it('resolves required link titles and user identifiers while skipping only missing inputs', async () => {
    const { table: foreignTable, textFieldId: foreignTitleId } = buildTable();
    const titleId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const linkId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
    const userId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const defaultUserId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(TableId.create(`tbl${'l'.repeat(16)}`)._unsafeUnwrap())
      .withBaseId(foreignTable.baseId())
      .withName(TableName.create('Required deferred imports')._unsafeUnwrap());
    builder.field().singleLineText().withId(titleId)
      .withName(FieldName.create('Title')._unsafeUnwrap()).primary().done();
    builder.field().link().withId(linkId)
      .withName(FieldName.create('Required Link')._unsafeUnwrap())
      .withNotNull(FieldNotNull.required())
      .withConfig(LinkFieldConfig.create({
        relationship: 'manyOne', foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignTitleId.toString(), isOneWay: true,
      })._unsafeUnwrap()).done();
    builder.field().user().withId(userId)
      .withName(FieldName.create('Required User')._unsafeUnwrap())
      .withNotNull(FieldNotNull.required()).done();
    builder.field().user().withId(defaultUserId)
      .withName(FieldName.create('Default User')._unsafeUnwrap())
      .withNotNull(FieldNotNull.required())
      .withDefaultValue(UserDefaultValue.create('me')._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const rows: unknown[][] = [
      ['first', 'Linked', 'alice@example.com'],
      ['missing link', '', 'alice@example.com'],
      ['missing user', 'Linked', ''],
      ['tail', 'Linked', 'alice@example.com'],
    ];
    const adapter = new FakeImportSourceAdapter(ok({ headers: ['Title', 'Link', 'User'], rows }));
    const tables = new FakeTableRepository([table, foreignTable]);
    const repository = new FakeTableRecordRepository();
    const foreignRecordId = `rec${'f'.repeat(16)}`;
    const users = [
      { id: 'usr-alice', name: 'Alice', email: 'alice@example.com' },
      { id: 'system', name: 'Current actor', email: 'system@example.com' },
    ];
    const userLookup: IUserLookupService = {
      listTableUsersByIdentifiers: async (_tableId, identifiers) => ok(users.filter((user) =>
        identifiers.some((value) => [user.id, user.name, user.email].includes(value))
      )),
      listUsersByIds: async (ids) => ok(users.filter((user) => ids.includes(user.id))),
      listUsersByIdentityPairs: async (pairs) => ok(users.filter((user) =>
        pairs.some((pair) => pair.id === user.id && pair.email === user.email)
      )),
    };
    const resolver = new RecordMutationSpecResolverService(
      new LinkTitleResolverService(tables, {
        find: async () => ok({
          records: [{ id: foreignRecordId, fields: { [foreignTitleId.toString()]: 'Linked' }, version: 1 }],
          total: 1,
        }),
      } as unknown as ITableRecordQueryRepository),
      new AttachmentValueResolverService({
        listAttachmentsByTokens: async () => ok([]),
        listAttachmentsByAttachmentIds: async () => ok([]),
      }),
      new UserValueResolverService(userLookup)
    );
    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter), tables, repository, resolver,
      createRecordWritePluginRunner(),
      { execute: () => ok({ table, updateResult: undefined }) } as unknown as RecordWriteSideEffectService,
      { execute: async () => ok({ table, events: [] }) } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );
    const command = ImportRecordsCommand.create({
      tableId: table.id().toString(), source: { type: 'csv', data: 'ignored' },
      sourceColumnMap: { [titleId.toString()]: 0, [linkId.toString()]: 1, [userId.toString()]: 2 },
      options: { typecast: true, skipFirstNLines: 0, batchSize: 500 },
    })._unsafeUnwrap();

    const result = (await handler.handle(createContext(), command))._unsafeUnwrap();
    expect(result.totalImported).toBe(2);
    expect(result.diagnostics).toMatchObject({ invalidDateCells: 0, skippedRows: 2 });
    expect(result.diagnostics!.samples.map((sample) => sample.rowNumber)).toEqual([2, 3]);
    expect(repository.inserted.map((record) => record.fields().get(titleId)?.toValue())).toEqual(['first', 'tail']);
    for (const record of repository.inserted) {
      expect(record.fields().get(linkId)?.toValue()).toMatchObject({ id: foreignRecordId, title: 'Linked' });
      expect(record.fields().get(userId)?.toValue()).toMatchObject({ id: 'usr-alice', title: 'Alice' });
      expect(record.fields().get(defaultUserId)?.toValue()).toMatchObject({ id: 'system' });
    }

    rows.splice(0, rows.length, ['unresolved user', 'Linked', { id: 'usr-missing' }]);
    const unresolved = await handler.handle(createContext(), command);
    expect(unresolved.isErr()).toBe(true);
    expect(unresolved._unsafeUnwrapErr().code).toBe('validation.field.user_not_found');
    expect(repository.inserted).toHaveLength(2);
  });

  it('rejects when a plugin blocks importAppend', async () => {
    const { table, textFieldId } = buildTable();
    const adapter = new FakeImportSourceAdapter(
      ok({
        headers: ['Title'],
        rows: [['Imported row']],
      })
    );
    const tableRecordRepository = new FakeTableRecordRepository();
    const blockingError = domainError.forbidden({
      code: 'plugin.import_blocked',
      message: 'blocked import',
    });

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        resolveCreatedRecords: async (
          ...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>
        ) => ok(input),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner([
        {
          name: 'import-blocker',
          supports: (operation) => operation === RecordWriteOperationKind.importAppend,
          guard: async () => err(blockingError),
        },
      ]),
      {
        execute: () => {
          throw new Error('recordWriteSideEffectService should not be called');
        },
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => {
          throw new Error('tableUpdateFlow should not be called');
        },
      } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );

    const command = ImportRecordsCommand.create({
      tableId: table.id().toString(),
      source: {
        type: 'csv',
        data: 'Title\nImported row',
      },
      sourceColumnMap: {
        [textFieldId.toString()]: 0,
      },
      options: {
        batchSize: 1,
        skipFirstNLines: 0,
        typecast: false,
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('plugin.import_blocked');
    expect(tableRecordRepository.inserted).toHaveLength(0);
    expect(adapter.parseCalls).toHaveLength(1);
  });

  it('skips plugins that do not support importAppend', async () => {
    const { table, textFieldId } = buildTable();
    const adapter = new FakeImportSourceAdapter(
      ok({
        headers: ['Title'],
        rows: [['Imported row']],
      })
    );
    const tableRecordRepository = new FakeTableRecordRepository();
    const { plugin, calls } = createTrackedRecordWritePlugin([RecordWriteOperationKind.createOne]);

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        resolveCreatedRecords: async (
          ...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>
        ) => ok(input),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner([plugin]),
      {
        execute: () => {
          throw new Error('recordWriteSideEffectService should not be called');
        },
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => {
          throw new Error('tableUpdateFlow should not be called');
        },
      } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );

    const command = ImportRecordsCommand.create({
      tableId: table.id().toString(),
      source: {
        type: 'csv',
        data: 'Title\nImported row',
      },
      sourceColumnMap: {
        [textFieldId.toString()]: 0,
      },
      options: {
        batchSize: 1,
        skipFirstNLines: 0,
        typecast: false,
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalImported).toBe(1);
    expect(tableRecordRepository.inserted).toHaveLength(1);
    expect(adapter.parseCalls).toHaveLength(1);
    expect(calls.supports).toEqual([
      RecordWriteOperationKind.importAppend,
      RecordWriteOperationKind.importAppend,
    ]);
    expect(calls.prepare).toHaveLength(0);
    expect(calls.prepareStates).toHaveLength(0);
    expect(calls.guard).toHaveLength(0);
    expect(calls.beforePersist).toHaveLength(0);
    expect(calls.afterCommit).toHaveLength(0);
  });

  it('returns validation.limit.rows_per_table_max for async sources that exceed maxRowCount', async () => {
    const { table, textFieldId } = buildTable();
    async function* rowsAsync() {
      yield ['row 1'];
      yield ['row 2'];
    }
    const adapter = new FakeImportSourceAdapter(
      ok({
        headers: ['Title'],
        rowsAsync: rowsAsync(),
      })
    );
    const tableRecordRepository = new FakeTableRecordRepository();
    const { plugin } = createTrackedRecordWritePlugin([RecordWriteOperationKind.importAppend]);

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        resolveCreatedRecords: async (
          ...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>
        ) => ok(input),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner([plugin]),
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), 'ignored', {
        typecast: true,
        maxRowCount: 1,
      })
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.rows_per_table_max');
    expect(adapter.parseCalls).toHaveLength(1);
  });

  it('pulls async source rows as insertManyStream consumes them', async () => {
    const { table, textFieldId } = buildTable();
    let pulled = 0;
    const pulledWhenInserted: number[] = [];
    async function* rowsAsync() {
      pulled += 1;
      yield ['row 1'];
      pulled += 1;
      yield ['row 2'];
    }
    const adapter = new FakeImportSourceAdapter(
      ok({
        headers: ['Title'],
        rowsAsync: rowsAsync(),
      })
    );
    const tableRecordRepository = new FakeTableRecordRepository();
    const originalInsertManyStream =
      tableRecordRepository.insertManyStream.bind(tableRecordRepository);
    tableRecordRepository.insertManyStream = async (context, target, batches, options) => {
      if (!isAsyncIterable(batches)) {
        return originalInsertManyStream(context, target, batches, options);
      }
      async function* tap() {
        for await (const batch of batches) {
          pulledWhenInserted.push(pulled);
          yield batch;
        }
      }
      return originalInsertManyStream(context, target, tap(), options);
    };

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        resolveCreatedRecords: async (
          ...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>
        ) => ok(input),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), 'ignored', {
        batchSize: 1,
        typecast: false,
        skipFirstNLines: 0,
      })
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalImported).toBe(2);
    expect(pulledWhenInserted).toEqual([1, 2]);
  });

  it('reports a source interruption as a retryable import failure with zero committed rows', async () => {
    const { table, textFieldId } = buildTable();
    const adapter = new FakeImportSourceAdapter(
      ok({
        headers: ['Title'],
        rows: [['row 1']],
      })
    );
    const tableRecordRepository = new FakeTableRecordRepository();
    tableRecordRepository.insertManyStream = async () =>
      err(
        domainError.infrastructure({
          code: 'record.insert_many_stream.source_interrupted',
          message: 'Record insert source was interrupted after 500 row(s) in 1 batch(es)',
          details: { insertedRows: 500, insertedBatches: 1, cause: 'terminated' },
        })
      );

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        resolveCreatedRecords: async (
          ...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>
        ) => ok(input),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), 'ignored', {
        batchSize: 500,
        typecast: false,
        skipFirstNLines: 0,
      })
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe('import.source_interrupted');
    expect(error.message).toContain('nothing was committed');
    expect(error.details).toMatchObject({
      insertedRows: 500,
      insertedBatches: 1,
      committedRows: 0,
      retryable: true,
    });
    expect(error.details).not.toHaveProperty('cause');
    expect(error.message).not.toContain('terminated');
  });

  it('skips an empty required row and imports the following row', async () => {
    const baseId = BaseId.create(`bse${'q'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'q'.repeat(16)}`)._unsafeUnwrap();
    const textFieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('Required Import')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(textFieldId)
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .withNotNull(FieldNotNull.required())
      .primary()
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const adapter = new FakeImportSourceAdapter(
      ok({
        headers: ['Title'],
        rows: [[''], ['tail']],
      })
    );
    const tableRecordRepository = new FakeTableRecordRepository();

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        resolveCreatedRecords: async (
          ...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>
        ) => ok(input),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), 'ignored')
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      totalImported: 1,
      diagnostics: {
        invalidDateCells: 0,
        skippedRows: 1,
        samples: [{ rowNumber: 1, reason: 'invalidRow', code: 'validation.field.not_null' }],
      },
    });
    expect(tableRecordRepository.inserted).toHaveLength(1);
    expect(tableRecordRepository.inserted[0]!.fields().get(textFieldId)?.toValue()).toBe('tail');

    // Skipping data errors must not bypass the existing source-row work limit.
    const limited = await handler.handle(createContext(), createCommand(
      table.id().toString(), textFieldId.toString(), 'ignored', { maxRowCount: 1 }
    ));
    expect(limited.isErr()).toBe(true);
    expect(limited._unsafeUnwrapErr().details).toMatchObject({ maxRowCount: 1, rowCount: 2 });
  });

  it('counts a padded blank Excel source row against the source cap before inserting', async () => {
    const { table, textFieldId } = buildTable();
    const adapter = new FakeImportSourceAdapter(ok({
      headers: ['Title'],
      rowCount: 4,
      rowsAsync: (async function* () {
        yield ['Title']; // A1 header
        yield ['first']; // A2
        yield ['']; // A3 is emitted by the Excel adapter's original padding policy.
        yield ['tail']; // A4 exceeds two admitted data rows.
      })(),
    }));
    const repository = new FakeTableRecordRepository();
    const progress: IImportProgress[] = [];
    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter), new FakeTableRepository([table]), repository,
      { resolveCreatedRecords: async (...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>) => ok(input) } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      { execute: () => ok({ table, updateResult: undefined }) } as unknown as RecordWriteSideEffectService,
      { execute: async () => ok({ table, events: [] }) } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );
    const command = ImportRecordsCommand.create({
      tableId: table.id().toString(), source: { type: 'excel', data: 'adapter-owned fixture' },
      sourceColumnMap: { [textFieldId.toString()]: 0 },
      options: {
        maxRowCount: 2, skipFirstNLines: 1, batchSize: 500,
        onProgress: (value) => { progress.push(value); },
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().details).toMatchObject({ maxRowCount: 2, rowCount: 3 });
    expect(repository.inserted).toEqual([]);
    expect(repository.insertedBatches).toEqual([]);
    expect(progress.some((value) => value.phase === 'completed')).toBe(false);
  });

  it('keeps the recorded failure when the source cleanup rejects a second time', async () => {
    const { table, textFieldId } = buildTable();
    const adapter = new FakeImportSourceAdapter(
      ok({
        headers: ['Title'],
        rowsAsync: {
          [Symbol.asyncIterator]() {
            return this;
          },
          async next() {
            return { done: true, value: undefined };
          },
          async return() {
            throw new Error('source already closed by the repository');
          },
        },
      })
    );
    const tableRecordRepository = new FakeTableRecordRepository();
    tableRecordRepository.insertManyStream = async () =>
      err(domainError.validation({ code: 'validation.field.not_null', message: 'write failed before inserting' }));

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        resolveCreatedRecords: async (
          ...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>
        ) => ok(input),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), 'ignored', {
        typecast: false,
        skipFirstNLines: 0,
      })
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('write failed before inserting');
    expect(result._unsafeUnwrapErr().code).toBe('validation.field.not_null');
  });

  it('checks importAppend plugins per append chunk instead of the whole imported row count', async () => {
    const { table, textFieldId } = buildTable();
    const adapter = new FakeImportSourceAdapter(
      ok({
        headers: ['Title'],
        rows: [['row 1'], ['row 2']],
      })
    );
    const tableRecordRepository = new FakeTableRecordRepository();
    const seenScopes: Array<{
      scope?: 'operation' | 'chunk';
      recordCount: number;
      recordsLength: number;
      chunkIndex?: number;
    }> = [];

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        resolveCreatedRecords: async (
          ...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>
        ) => ok(input),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner([
        {
          name: 'chunk-record-limit',
          supports: (operation) => operation === RecordWriteOperationKind.importAppend,
          async guard(context) {
            seenScopes.push({
              scope: context.orchestration?.scope,
              recordCount: context.payload.recordCount,
              recordsLength: context.payload.recordsFieldValues.length,
              chunkIndex: context.orchestration?.chunkIndex,
            });

            if (context.orchestration?.scope === 'chunk' && context.payload.recordCount > 1) {
              return err(
                domainError.validation({
                  code: 'validation.limit.records_per_mutation_max',
                  message: 'too many rows in one mutation',
                })
              );
            }

            return ok(undefined);
          },
        },
      ]),
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), undefined, {
        batchSize: 1,
        typecast: true,
      })
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalImported).toBe(2);
    expect(tableRecordRepository.insertedBatches.map((batch) => batch.length)).toEqual([1, 1]);
    expect(seenScopes).toEqual([
      { scope: 'operation', recordCount: 2, recordsLength: 0, chunkIndex: undefined },
      { scope: 'chunk', recordCount: 1, recordsLength: 1, chunkIndex: 0 },
      { scope: 'chunk', recordCount: 1, recordsLength: 1, chunkIndex: 1 },
    ]);
  });

  it('stops before insert when plugin beforePersist rejects', async () => {
    const { table, textFieldId } = buildTable();
    const adapter = new FakeImportSourceAdapter(
      ok({
        headers: ['Title'],
        rows: [['Imported row']],
      })
    );
    const tableRecordRepository = new FakeTableRecordRepository();
    const beforePersistError = domainError.forbidden({
      code: 'plugin.before_persist_blocked',
      message: 'before persist blocked',
    });

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        resolveCreatedRecords: async (
          ...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>
        ) => ok(input),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner([
        {
          name: 'before-persist-blocker',
          supports: (operation) => operation === RecordWriteOperationKind.importAppend,
          async beforePersist() {
            return err(beforePersistError);
          },
        },
      ]),
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), undefined, { typecast: true })
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('plugin.before_persist_blocked');
    expect(tableRecordRepository.inserted).toHaveLength(0);
  });

  it('persists discovered side effects and publishes collected events', async () => {
    const { table, textFieldId } = buildTable();
    const adapter = new FakeImportSourceAdapter(
      ok({
        headers: ['Title'],
        rows: [['Imported row']],
      })
    );
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const event = FieldOptionsAdded.create({
      tableId: table.id(),
      baseId: table.baseId(),
      fieldId: textFieldId,
      options: [{ id: 'choImported', name: 'Imported choice', color: 'blue' }],
    });

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        resolveCreatedRecords: async (
          ...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>
        ) => ok(input),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      {
        execute: () => {
          return ok({
            table,
            updateResult: {
              table,
              events: [event],
            },
          });
        },
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => {
          return ok({ table, events: [event] });
        },
      } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), eventBus)
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), undefined, { typecast: true })
    );

    expect(result.isOk()).toBe(true);
    const published = eventBus.publishedMany.flat();
    expect(published.map((item) => item.name.toString())).toEqual([
      'FieldOptionsAdded',
      'RecordsBatchCreated',
    ]);
    expect(published[0]).toMatchObject({
      fieldId: textFieldId,
      options: [{ id: 'choImported', name: 'Imported choice', color: 'blue' }],
    });
    const created = published.find(isRecordsBatchCreatedEvent);
    expect(created?.source).toEqual({ type: 'import' });
    expect(created?.records).toEqual([
      {
        recordId: tableRecordRepository.inserted[0].id().toString(),
        fields: [{ fieldId: textFieldId.toString(), value: 'Imported row' }],
      },
    ]);
    expect(table.pullDomainEvents().map((pending) => pending.name.toString())).toEqual([
      'TableCreated',
    ]);
    expect(tableRecordRepository.inserted).toHaveLength(1);
    expect(tableRecordRepository.insertManyStreamOptions).toMatchObject({
      deferComputedUpdates: true,
      enqueueDeferredComputedUpdates: true,
    });
  });

  it('resolves mutate specs before yielding imported records', async () => {
    const { table, textFieldId } = buildTable();
    const adapter = new FakeImportSourceAdapter(
      ok({
        headers: ['Title'],
        rows: [['Imported row']],
      })
    );
    const tableRecordRepository = new FakeTableRecordRepository();
    // Real record/spec so the handler's reapply uses the same materializer as production.
    const recordId = RecordId.create(`rec${'r'.repeat(16)}`)._unsafeUnwrap();
    const originalRecord = TableRecord.create({
      id: recordId,
      tableId: table.id(),
      fieldValues: [],
    })._unsafeUnwrap();
    const resolvedSpec = new SetSingleLineTextValueSpec(
      textFieldId,
      CellValue.fromValidated('resolved')
    );

    // The handler only needs this write seam; keep the cast named so the unchecked shape is explicit.
    const tableWithStubbedCreate = table as unknown as {
      createRecords: typeof table.createRecords;
    };
    tableWithStubbedCreate.createRecords = () =>
      ok({
        records: [originalRecord],
        mutateSpecs: [resolvedSpec],
      });

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        // Reuse the production reapply path so the record is materialized exactly as in
        // the handler's default wiring; only the resolver result is stubbed.
        resolveCreatedRecords: RecordMutationSpecResolverService.prototype.resolveCreatedRecords,
        // A real resolution yields a replaced spec instance, which is what makes the
        // shared resolver re-materialize the record.
        resolveAndReplaceMany: async () =>
          ok([new SetSingleLineTextValueSpec(textFieldId, CellValue.fromValidated('resolved'))]),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus())
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), undefined, { typecast: true })
    );

    expect(result.isOk()).toBe(true);
    expect(tableRecordRepository.inserted).toHaveLength(1);
    expect(tableRecordRepository.inserted[0]?.id().equals(recordId)).toBe(true);
    expect(tableRecordRepository.inserted[0]?.fields().get(textFieldId)?.toValue()).toBe(
      'resolved'
    );
  });
});
