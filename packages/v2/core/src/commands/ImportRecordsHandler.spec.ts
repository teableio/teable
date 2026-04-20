import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import type { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
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
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
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
} from '../ports/import/IImportSource';
import type { IImportSourceAdapter } from '../ports/import/IImportSourceAdapter';
import type { IImportSourceRegistry } from '../ports/import/IImportSourceRegistry';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  BatchRecordMutationResult,
  InsertManyStreamOptions,
  ITableRecordRepository,
  RecordMutationResult,
  UpdateManyStreamResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { ImportRecordsCommand } from './ImportRecordsCommand';
import { ImportRecordsHandler } from './ImportRecordsHandler';
import {
  createRecordWritePluginRunner,
  createTrackedRecordWritePlugin,
  expectRecordWritePluginToBeSkipped,
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
    let totalInserted = 0;
    let batchIndex = 0;

    if (isAsyncIterable(batches)) {
      for await (const batch of batches) {
        this.inserted.push(...batch);
        totalInserted += batch.length;
        options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
        batchIndex += 1;
      }
    } else {
      for (const batch of batches) {
        this.inserted.push(...batch);
        totalInserted += batch.length;
        options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
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
        needsResolution: async () => ok(false),
        resolveAndReplaceMany: async () => ok([]),
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
      new FakeEventBus(),
      new FakeUnitOfWork()
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
        needsResolution: async () => ok(false),
        resolveAndReplaceMany: async () => ok([]),
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
      new FakeEventBus(),
      new FakeUnitOfWork()
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
    expectRecordWritePluginToBeSkipped(calls, RecordWriteOperationKind.importAppend);
  });

  it('returns validation.max_row_limit for async sources that exceed maxRowCount', async () => {
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
    const { plugin, calls } = createTrackedRecordWritePlugin([
      RecordWriteOperationKind.importAppend,
    ]);

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        needsResolution: () => ok(false),
        resolveAndReplaceMany: async () => ok([]),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner([plugin]),
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), 'ignored', {
        typecast: true,
        maxRowCount: 1,
      })
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.max_row_limit');
    expect(tableRecordRepository.inserted).toHaveLength(0);
    expect(calls.prepare).toHaveLength(0);
    expect(calls.guard).toHaveLength(0);
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
        needsResolution: () => ok(false),
        resolveAndReplaceMany: async () => ok([]),
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
      new FakeEventBus(),
      new FakeUnitOfWork()
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
    const event = { type: 'import.side_effect.persisted' } as IDomainEvent;
    let sideEffectCalls = 0;
    let updateFlowCalls = 0;

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        needsResolution: () => ok(false),
        resolveAndReplaceMany: async () => ok([]),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      {
        execute: () => {
          sideEffectCalls += 1;
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
          updateFlowCalls += 1;
          return ok({ table, events: [event] });
        },
      } as unknown as TableUpdateFlow,
      eventBus,
      new FakeUnitOfWork()
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), undefined, { typecast: true })
    );

    expect(result.isOk()).toBe(true);
    expect(sideEffectCalls).toBe(1);
    expect(updateFlowCalls).toBe(1);
    expect(eventBus.publishedMany).toEqual([[event]]);
    expect(tableRecordRepository.inserted).toHaveLength(1);
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
    const originalRecord = { id: 'raw-record' } as unknown as TableRecord;
    const resolvedRecord = { id: 'resolved-record' } as unknown as TableRecord;
    const mutateSpec = {
      mutate: () => ok(resolvedRecord),
    } as unknown as ICellValueSpec;

    (
      table as unknown as {
        createRecords: typeof table.createRecords;
      }
    ).createRecords = () =>
      ok({
        records: [originalRecord],
        mutateSpecs: [mutateSpec],
      });

    const handler = new ImportRecordsHandler(
      new FakeImportSourceRegistry(adapter),
      new FakeTableRepository([table]),
      tableRecordRepository,
      {
        needsResolution: () => ok(true),
        resolveAndReplaceMany: async () => ok([mutateSpec]),
      } as unknown as RecordMutationSpecResolverService,
      createRecordWritePluginRunner(),
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), undefined, { typecast: true })
    );

    expect(result.isOk()).toBe(true);
    expect(tableRecordRepository.inserted).toEqual([resolvedRecord]);
  });
});
