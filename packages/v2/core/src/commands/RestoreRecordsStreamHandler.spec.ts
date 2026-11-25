import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { withCreatedTableActorStorage } from '../application/services/TableCreationService';
import { TableQueryService } from '../application/services/TableQueryService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import { NoopTableRecordRepository } from '../ports/defaults/NoopTableRecordRepository';
import type { IDurableSubscriptionCatalog } from '../ports/DurableSubscriptionCatalog';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import { type IFindOptions } from '../ports/RepositoryQuery';
import type { RecordRestoreSystemValues } from '../ports/TableRecordRepository';
import {
  isInsertManyStreamBatch,
  type InsertManyStreamBatchInput,
  type InsertManyStreamOptions,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import { NoopTableSchemaCoordination } from '../ports/TableSchemaCoordination';
import type {
  ITransactionalProjectionMessageJournal,
  ProjectionMessageDraft,
} from '../ports/TransactionalProjectionMessageJournal';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { createRecordWritePluginRunner } from './recordWritePluginRunnerTestUtils';
import { RestoreRecordsStreamCommand } from './RestoreRecordsStreamCommand';
import type { RestoreRecordsStreamEvent } from './RestoreRecordsStreamHandler';
import { RestoreRecordsStreamHandler } from './RestoreRecordsStreamHandler';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const buildTable = () => {
  const baseId = BaseId.create(`bse${'r'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'s'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Restore Stream Table')._unsafeUnwrap();
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

  return { table: builder.build()._unsafeUnwrap(), tableId, textFieldId };
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

  async restore(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class CapturingTableRecordRepository extends NoopTableRecordRepository {
  batchSizes: number[] = [];
  transactionKinds: Array<IExecutionContext['transaction']> = [];
  options: Array<InsertManyStreamOptions | undefined> = [];
  restoreMaps: Array<ReadonlyMap<string, RecordRestoreSystemValues>> = [];

  override async insertManyStream(
    context: IExecutionContext,
    _: Table,
    batches: Iterable<InsertManyStreamBatchInput> | AsyncIterable<InsertManyStreamBatchInput>,
    options?: InsertManyStreamOptions
  ) {
    let totalInserted = 0;
    let batchIndex = 0;

    for (const batchInput of batches as Iterable<InsertManyStreamBatchInput>) {
      const records: ReadonlyArray<TableRecord> = isInsertManyStreamBatch(batchInput)
        ? batchInput.records
        : batchInput;
      this.batchSizes.push(records.length);
      if (isInsertManyStreamBatch(batchInput))
        this.restoreMaps.push(batchInput.restoreRecordsById ?? new Map());
      this.transactionKinds.push(context.transaction);
      this.options.push(options);
      totalInserted += records.length;
      options?.onBatchInserted?.({
        batchIndex,
        insertedCount: records.length,
        totalInserted,
      });
      batchIndex += 1;
    }

    return ok({ totalInserted });
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
const emptyCatalog: IDurableSubscriptionCatalog = {
  snapshot: () =>
    ok({
      generation: 0,
      resolve: () =>
        ok({
          messageName: 'table.records.batch-created.v1',
          durableMode: 'active',
          sameTxTargets: [],
          durableTargets: [],
          directTargets: [],
        }),
    }),
};
const emptyJournal: ITransactionalProjectionMessageJournal = { append: async () => ok([]) };

describe('RestoreRecordsStreamHandler', () => {
  it.each([false, true])(
    'keeps the original known/unknown server creator with current App execution (%s)',
    async (known) => {
      const built = buildTable();
      const table = withCreatedTableActorStorage(built.table)._unsafeUnwrap();
      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const repository = new CapturingTableRecordRepository();
      const recordId = `rec${'a'.repeat(16)}`;
      const original = known ? { type: 'user' as const, id: 'usrOriginal' } : null;
      const command = RestoreRecordsStreamCommand.create(
        {
          tableId: table.id().toString(),
          batchSize: 1,
          records: (async function* () {
            yield {
              recordId,
              fields: { [built.textFieldId.toString()]: 'Restored' },
              createdByActorType: 'appUser',
              createdByActorId: 'forged',
            };
          })(),
        },
        { trustedCreatedActorsByRecordId: new Map([[recordId, original]]) }
      )._unsafeUnwrap();
      const handler = new RestoreRecordsStreamHandler(
        new TableQueryService(tableRepository),
        repository,
        new FakeUnitOfWork(),
        createRecordWritePluginRunner(),
        new NoopTableSchemaCoordination(),
        emptyCatalog,
        emptyJournal
      );
      const context = {
        ...createContext(),
        initiator: { type: 'appUser' as const, id: 'apuCurrent' },
        requireActorStorage: true,
      };
      const stream = (await handler.handle(context, command))._unsafeUnwrap();
      const events = await collectRestoreStreamEvents(stream);
      expect(events[events.length - 1]).toEqual({ id: 'done', restoredCount: 1 });
      expect(repository.restoreMaps[0]?.get(recordId)?.createdByActor).toEqual(original);
      expect(repository.transactionKinds[0]).toBeDefined();
    }
  );

  it('does not trust mixed archive actor claims and persists bounded summaries per committed batch', async () => {
    const built = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(built.table);
    const repository = new CapturingTableRecordRepository();
    const unitOfWork = new FakeUnitOfWork();
    const messages: ProjectionMessageDraft[] = [];
    const catalog: IDurableSubscriptionCatalog = {
      snapshot: () =>
        ok({
          generation: 1,
          resolve: () =>
            ok({
              messageName: 'table.records.batch-created.v1',
              durableMode: 'active',
              sameTxTargets: [],
              directTargets: [],
              durableTargets: [
                {
                  consumerId: 'test.restore.audit',
                  consumerGeneration: 1,
                  retry: { maxAttempts: 3, policy: 'exponential-jitter' },
                  ordering: 'none',
                  idempotency: 'destination-inbox',
                  replay: 'safe',
                },
              ],
            }),
        }),
    };
    const journal: ITransactionalProjectionMessageJournal = {
      append: async (context, drafts) => {
        expect(context.transaction).toBe(
          unitOfWork.transactions[unitOfWork.transactions.length - 1].transaction
        );
        expect(context.initiator).toEqual({ type: 'user', id: 'usrCurrent' });
        messages.push(...drafts);
        return ok(drafts.map((draft) => ({ eventId: draft.eventId })));
      },
    };
    const command = RestoreRecordsStreamCommand.create({
      tableId: built.tableId.toString(),
      batchSize: 250,
      records: (async function* () {
        for (let index = 0; index < 251; index++)
          yield {
            recordId: `rec${index.toString().padStart(16, '0')}`,
            fields: {},
            createdByActorType: index % 2 ? 'user' : 'appUser',
            createdByActorId: 'forgedArchiveActor',
          };
      })(),
      trustedCreatedActorsByRecordId: new Map(),
    } as Parameters<typeof RestoreRecordsStreamCommand.create>[0])._unsafeUnwrap();
    const handler = new RestoreRecordsStreamHandler(
      new TableQueryService(tableRepository),
      repository,
      unitOfWork,
      createRecordWritePluginRunner(),
      new NoopTableSchemaCoordination(),
      catalog,
      journal
    );
    const events = await collectRestoreStreamEvents(
      (
        await handler.handle(
          { ...createContext(), initiator: { type: 'user', id: 'usrCurrent' } },
          command
        )
      )._unsafeUnwrap()
    );
    expect(events.filter((event) => event.id === 'progress')).toHaveLength(2);
    expect(messages).toHaveLength(2);
    expect(messages[0].payload).toMatchObject({ recordCount: 250, source: { type: 'import' } });
    expect(messages[1].payload).toMatchObject({ recordCount: 1 });
    expect(JSON.stringify(messages)).not.toContain('forgedArchiveActor');
    for (const map of repository.restoreMaps)
      for (const values of map.values()) {
        expect(values).not.toHaveProperty('createdByActor');
      }
  });

  it('rejects trusted App imports from a table without actor storage', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(
      table
        .dbTableName()
        .andThen((dbTableName) =>
          Table.rehydrate({
            id: table.id(),
            baseId: table.baseId(),
            name: table.name(),
            properties: table.properties(),
            fields: table.getFields(),
            views: table.views(),
            primaryFieldId: table.primaryFieldId(),
            dbTableName,
            searchIndex: table.searchIndex(),
            actorStorageVersion: 0,
          })
        )
        ._unsafeUnwrap()
    );
    const records = new CapturingTableRecordRepository();
    const handler = new RestoreRecordsStreamHandler(
      new TableQueryService(tableRepository),
      records,
      new FakeUnitOfWork(),
      createRecordWritePluginRunner(),
      new NoopTableSchemaCoordination(),
      emptyCatalog,
      emptyJournal
    );
    const result = await handler.handle(
      {
        ...createContext(),
        initiator: { type: 'appUser', id: 'apuActor' },
        requireActorStorage: true,
      },
      RestoreRecordsStreamCommand.create({
        tableId: tableId.toString(),
        records: (async function* () {
          yield { recordId: `rec${'c'.repeat(16)}`, fields: { [textFieldId.toString()]: 'Value' } };
        })(),
      })._unsafeUnwrap()
    );
    const events = await collectRestoreStreamEvents(result._unsafeUnwrap());
    expect(events).toEqual([
      expect.objectContaining({
        id: 'error',
        phase: 'preparing',
        code: 'actor_storage.not_enabled',
      }),
    ]);
    expect(records.batchSizes).toEqual([]);
  });

  it('loads fresh metadata under a shared lease and releases on consumer cancellation', async () => {
    const { table, tableId, textFieldId } = buildTable();
    let held = false;
    const tableRepository = new FakeTableRepository();
    tableRepository.findOne = async () => {
      expect(held).toBe(true);
      return ok(table);
    };
    const command = RestoreRecordsStreamCommand.create({
      tableId: tableId.toString(),
      batchSize: 1,
      records: (async function* () {
        yield {
          recordId: `rec${'a'.repeat(16)}`,
          fields: { [textFieldId.toString()]: 'Imported' },
        };
        yield { recordId: `rec${'b'.repeat(16)}`, fields: {} };
      })(),
    })._unsafeUnwrap();
    const handler = new RestoreRecordsStreamHandler(
      new TableQueryService(tableRepository),
      new CapturingTableRecordRepository(),
      new FakeUnitOfWork(),
      createRecordWritePluginRunner(),
      {
        acquire: async (_context, tableIds, mode) => {
          expect(mode).toBe('shared');
          held = true;
          return ok({
            mode,
            tableIds,
            release: async () => {
              held = false;
            },
          });
        },
      },
      emptyCatalog,
      emptyJournal
    );
    const stream = (await handler.handle(createContext(), command))._unsafeUnwrap();
    const iterator = stream[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ id: 'progress' });
    expect(held).toBe(true);
    await iterator.return?.();
    expect(held).toBe(false);
  });

  it('commits each restored stream batch in its own short transaction', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new CapturingTableRecordRepository();
    const unitOfWork = new FakeUnitOfWork();

    const records = async function* () {
      for (let index = 0; index < 5; index += 1) {
        yield {
          recordId: `rec${index.toString().padStart(14, '0')}ab`,
          fields: { [textFieldId.toString()]: `Record ${index}` },
        };
      }
    };

    const command = RestoreRecordsStreamCommand.create({
      tableId: tableId.toString(),
      records: records(),
      batchSize: 2,
    })._unsafeUnwrap();

    const handler = new RestoreRecordsStreamHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      unitOfWork,
      createRecordWritePluginRunner(),
      new NoopTableSchemaCoordination(),
      emptyCatalog,
      emptyJournal
    );

    const result = await handler.handle(createContext(), command);
    const events = await collectRestoreStreamEvents(result._unsafeUnwrap());

    expect(recordRepository.batchSizes).toEqual([2, 2, 1]);
    expect(unitOfWork.transactions).toHaveLength(3);
    expect(
      recordRepository.transactionKinds.every(
        (transaction) => transaction?.kind === 'unitOfWorkTransaction'
      )
    ).toBe(true);
    expect(events).toEqual([
      { id: 'progress', phase: 'restoring', batchIndex: 0, insertedCount: 2, totalInserted: 2 },
      { id: 'progress', phase: 'restoring', batchIndex: 1, insertedCount: 2, totalInserted: 4 },
      { id: 'progress', phase: 'restoring', batchIndex: 2, insertedCount: 1, totalInserted: 5 },
      { id: 'done', restoredCount: 5 },
    ]);
  });

  it('passes deferred computed option to streamed restore batches', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new CapturingTableRecordRepository();
    const unitOfWork = new FakeUnitOfWork();

    const records = async function* () {
      yield {
        recordId: `rec${'d'.repeat(16)}`,
        fields: { [textFieldId.toString()]: 'Record' },
      };
    };

    const command = RestoreRecordsStreamCommand.create({
      tableId: tableId.toString(),
      records: records(),
      batchSize: 1,
      deferComputedUpdates: true,
      enqueueDeferredComputedUpdates: true,
    })._unsafeUnwrap();

    const handler = new RestoreRecordsStreamHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      unitOfWork,
      createRecordWritePluginRunner(),
      new NoopTableSchemaCoordination(),
      emptyCatalog,
      emptyJournal
    );

    const result = await handler.handle(createContext(), command);
    await collectRestoreStreamEvents(result._unsafeUnwrap());

    expect(recordRepository.options).toHaveLength(1);
    expect(recordRepository.options[0]).toMatchObject({
      deferComputedUpdates: true,
      enqueueDeferredComputedUpdates: true,
      skipComputedUpdates: false,
    });
  });
});

async function collectRestoreStreamEvents(stream: AsyncIterable<RestoreRecordsStreamEvent>) {
  const events: RestoreRecordsStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
