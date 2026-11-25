import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableQueryService } from '../application/services/TableQueryService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { isRecordsBatchCreatedEvent } from '../domain/table/events/RecordsBatchCreated';
import { isRecordsBatchUpdatedEvent } from '../domain/table/events/RecordsBatchUpdated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import type { RecordId } from '../domain/table/records/RecordId';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import { NoopTableRecordRepository } from '../ports/defaults/NoopTableRecordRepository';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import { EventBusDomainWriteTransaction } from '../ports/memory/EventBusDomainWriteTransaction';
import type { IRecordWritePlugin } from '../ports/RecordWritePlugin';
import { type IFindOptions } from '../ports/RepositoryQuery';
import type {
  InsertOptions,
  RestoredSelfReferentialLinkRecord,
  RestoreSelfReferentialLinksOptions,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { createRecordWritePluginRunner } from './recordWritePluginRunnerTestUtils';
import { RestoreRecordsCommand } from './RestoreRecordsCommand';
import { RestoreRecordsHandler } from './RestoreRecordsHandler';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const withActorStorageVersion = (table: Table, version: number): Table =>
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
        actorStorageVersion: version,
      })
    )
    ._unsafeUnwrap();

const buildTable = () => {
  const baseId = BaseId.create(`bse${'r'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'s'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Restore Stream Table')._unsafeUnwrap();
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

  return { table: builder.build()._unsafeUnwrap(), tableId, textFieldId, numberFieldId };
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
  restoreMaps: Array<
    ReadonlyMap<
      string,
      NonNullable<InsertOptions['restoreRecordsById']> extends ReadonlyMap<string, infer TValue>
        ? TValue
        : never
    >
  > = [];
  cleanupTrashRecordIds: string[][] = [];
  insertOptions: Array<InsertOptions | undefined> = [];
  insertedRecords: TableRecord[] = [];
  transactionKinds: Array<IExecutionContext['transaction']> = [];
  existingIds = new Set<string>();

  override async insertMany(
    context: IExecutionContext,
    _: Table,
    records: ReadonlyArray<TableRecord>,
    options?: InsertOptions
  ) {
    this.batchSizes.push(records.length);
    this.restoreMaps.push(new Map(options?.restoreRecordsById ?? []));
    this.cleanupTrashRecordIds.push([...(options?.cleanupTrashRecordIds ?? [])]);
    this.insertOptions.push(options);
    this.insertedRecords.push(...records);
    this.transactionKinds.push(context.transaction);
    return ok({});
  }

  async listExistingRecordIds(
    _context: IExecutionContext,
    _table: Table,
    recordIds: ReadonlyArray<string>
  ) {
    return ok(new Set(recordIds.filter((recordId) => this.existingIds.has(recordId))));
  }
}

class FakeEventBus implements IEventBus {
  events: IDomainEvent[] = [];
  batchEventSizes: number[] = [];

  async publish(_: IExecutionContext, event: IDomainEvent) {
    this.events.push(event);
    this.batchEventSizes.push(1);
    return ok(undefined);
  }

  async publishMany(_: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    this.events.push(...events);
    this.batchEventSizes.push(events.length);
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

describe('RestoreRecordsHandler', () => {
  it.each([
    ['appUser' as const, 0, true],
    ['appUser' as const, 1, false],
    ['user' as const, 0, false],
  ])(
    'gates trusted %s restores on actor capability %s (conflict %s)',
    async (type, version, conflicts) => {
      const { table, tableId, textFieldId } = buildTable();
      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(withActorStorageVersion(table, version));
      const records = new CapturingTableRecordRepository();
      const handler = new RestoreRecordsHandler(
        new TableQueryService(tableRepository),
        records,
        new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus()),
        createRecordWritePluginRunner()
      );
      const command = RestoreRecordsCommand.create({
        tableId: tableId.toString(),
        records: [
          { recordId: `rec${'z'.repeat(16)}`, fields: { [textFieldId.toString()]: 'Value' } },
        ],
      })._unsafeUnwrap();
      const result = await handler.handle(
        {
          ...createContext(),
          initiator: { type, id: 'usrActor' },
          requireActorStorage: type === 'appUser',
        },
        command
      );
      expect(result.isErr()).toBe(conflicts);
      if (conflicts) expect(result._unsafeUnwrapErr().code).toBe('actor_storage.not_enabled');
      expect(records.restoreMaps.length).toBe(conflicts ? 0 : 1);
    }
  );

  it('releases the shared lease after rejecting a disabled App restore', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    let released = false;
    tableRepository.tables.push(withActorStorageVersion(table, 0));
    const handler = new RestoreRecordsHandler(
      new TableQueryService(tableRepository),
      new CapturingTableRecordRepository(),
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus()),
      createRecordWritePluginRunner(),
      {
        acquire: async (_context, ids, mode) =>
          ok({
            mode,
            tableIds: ids,
            release: async () => {
              released = true;
            },
          }),
      }
    );
    const command = RestoreRecordsCommand.create({
      tableId: tableId.toString(),
      records: [
        { recordId: `rec${'y'.repeat(16)}`, fields: { [textFieldId.toString()]: 'Value' } },
      ],
    })._unsafeUnwrap();
    const result = await handler.handle(
      {
        ...createContext(),
        initiator: { type: 'appUser', id: 'apuActor' },
        requireActorStorage: true,
      },
      command
    );
    expect(result._unsafeUnwrapErr().code).toBe('actor_storage.not_enabled');
    expect(released).toBe(true);
  });

  it.each([false, true])(
    'restores only server creator metadata while holding the shared lease (%s)',
    async (knownCreator) => {
      const { table, tableId, textFieldId } = buildTable();
      const tableRepository = new FakeTableRepository();
      let held = false;
      let released = false;
      tableRepository.findOne = async () => {
        expect(held).toBe(true);
        return ok(withActorStorageVersion(table, 1));
      };
      const records = new CapturingTableRecordRepository();
      const handler = new RestoreRecordsHandler(
        new TableQueryService(tableRepository),
        records,
        new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus()),
        createRecordWritePluginRunner(),
        {
          acquire: async (_context, ids, mode) => {
            expect(ids).toEqual([tableId.toString()]);
            expect(mode).toBe('shared');
            held = true;
            return ok({
              mode,
              tableIds: ids,
              release: async () => {
                held = false;
                released = true;
              },
            });
          },
        }
      );
      const recordId = `rec${'a'.repeat(16)}`;
      const original = knownCreator ? { type: 'user' as const, id: 'usrOriginal' } : null;
      const command = RestoreRecordsCommand.create(
        {
          tableId: tableId.toString(),
          records: [
            {
              recordId,
              fields: { [textFieldId.toString()]: 'Restored' },
              createdByActorType: 'user',
              createdByActorId: 'forged',
            },
          ],
        },
        { trustedCreatedActorsByRecordId: new Map([[recordId, original]]) }
      )._unsafeUnwrap();
      const result = await handler.handle(
        { ...createContext(), initiator: { type: 'appUser', id: 'apuCurrent' } },
        command
      );
      if (result.isErr()) throw new Error(`Trusted restore failed: ${result.error.code}`);
      expect(result.value.restoredCount).toBe(1);
      expect(records.restoreMaps[0]?.get(recordId)?.createdByActor).toEqual(original);
      expect(records.restoreMaps[0]?.get(recordId)).not.toHaveProperty('lastModifiedByActor');
      expect(released).toBe(true);
    }
  );

  it('restores records with system metadata and publishes a batch created event', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new CapturingTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new RestoreRecordsHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      createRecordWritePluginRunner()
    );

    const command = RestoreRecordsCommand.create({
      tableId: tableId.toString(),
      records: [
        {
          recordId: `rec${'u'.repeat(14)}01`,
          fields: {
            [textFieldId.toString()]: 'Restored value',
            [numberFieldId.toString()]: 8,
          },
          orders: {
            [`viw${'v'.repeat(14)}01`]: 3,
          },
          autoNumber: 8,
          createdTime: '2025-01-01T00:00:00.000Z',
          createdBy: `usr${'w'.repeat(16)}`,
          lastModifiedTime: '2025-01-02T00:00:00.000Z',
          lastModifiedBy: `usr${'x'.repeat(16)}`,
        },
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const payload = result._unsafeUnwrap();

    expect(payload.restoredCount).toBe(1);
    expect(recordRepository.batchSizes).toEqual([1]);
    expect(recordRepository.cleanupTrashRecordIds).toEqual([[command.records[0]!.recordId]]);
    expect(recordRepository.insertedRecords).toHaveLength(1);
    expect(recordRepository.restoreMaps[0]?.get(command.records[0]!.recordId)).toEqual({
      orders: command.records[0]!.orders,
      autoNumber: 8,
      createdTime: '2025-01-01T00:00:00.000Z',
      createdBy: `usr${'w'.repeat(16)}`,
      lastModifiedTime: '2025-01-02T00:00:00.000Z',
      lastModifiedBy: `usr${'x'.repeat(16)}`,
    });
    expect(unitOfWork.transactions).toHaveLength(1);
    expect(eventBus.events).toHaveLength(1);
    expect(isRecordsBatchCreatedEvent(eventBus.events[0]!)).toBe(true);
  });

  it('restores records in bounded batches, committing and publishing each batch separately', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const recordRepository = new CapturingTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new RestoreRecordsHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      createRecordWritePluginRunner()
    );

    const records = Array.from({ length: 1001 }, (_, index) => ({
      recordId: `rec${index.toString().padStart(14, '0')}ab`,
      fields: {
        [textFieldId.toString()]: `Record ${index}`,
        [numberFieldId.toString()]: index,
      },
      orders: { viwRestore: index + 1 },
      autoNumber: index + 1,
      createdTime: '2026-03-27T00:00:00.000Z',
      createdBy: 'usrCreatedBy000001',
      lastModifiedTime: '2026-03-27T00:00:00.000Z',
      lastModifiedBy: 'usrModifiedBy00001',
    }));

    const command = RestoreRecordsCommand.create({
      tableId: tableId.toString(),
      records,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const payload = result._unsafeUnwrap();

    expect(payload.restoredCount).toBe(1001);
    expect(recordRepository.batchSizes).toEqual([500, 500, 1]);
    expect(recordRepository.cleanupTrashRecordIds).toEqual([
      records.slice(0, 500).map((record) => record.recordId),
      records.slice(500, 1000).map((record) => record.recordId),
      [records[1000]!.recordId],
    ]);
    expect(unitOfWork.transactions).toHaveLength(3);
    expect(
      recordRepository.transactionKinds.every(
        (transaction) => transaction?.kind === 'unitOfWorkTransaction'
      )
    ).toBe(true);
    expect(eventBus.events).toHaveLength(3);
    expect(eventBus.batchEventSizes).toEqual([1, 1, 1]);
    expect(payload.events).toHaveLength(3);

    const firstBatchFirstRecord = recordRepository.restoreMaps[0]?.get(records[0]!.recordId);
    expect(firstBatchFirstRecord).toMatchObject({
      orders: { viwRestore: 1 },
      autoNumber: 1,
      createdTime: '2026-03-27T00:00:00.000Z',
      createdBy: 'usrCreatedBy000001',
      lastModifiedTime: '2026-03-27T00:00:00.000Z',
      lastModifiedBy: 'usrModifiedBy00001',
    });

    const lastBatchRecord = recordRepository.restoreMaps[2]?.get(records[1000]!.recordId);
    expect(lastBatchRecord).toMatchObject({
      orders: { viwRestore: 1001 },
      autoNumber: 1001,
    });

    const firstEvent = eventBus.events.find(isRecordsBatchCreatedEvent);
    const lastEvent = [...eventBus.events].reverse().find(isRecordsBatchCreatedEvent);
    expect(firstEvent).toBeDefined();
    expect(lastEvent).toBeDefined();
    expect(firstEvent!.records).toHaveLength(500);
    expect(lastEvent!.records).toHaveLength(1);
    expect(lastEvent!.records[0]?.recordId).toBe(records[1000]!.recordId);
  });

  it('scales restore batches up for very large undos while keeping per-batch transactions and events', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const recordRepository = new CapturingTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new RestoreRecordsHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      createRecordWritePluginRunner()
    );

    const totalRecords = 11_000;
    const records = Array.from({ length: totalRecords }, (_, index) => ({
      recordId: `rec${index.toString().padStart(14, '0')}xy`,
      fields: {
        [textFieldId.toString()]: `Record ${index}`,
        [numberFieldId.toString()]: index,
      },
      orders: { viwRestore: index + 1 },
    }));

    const command = RestoreRecordsCommand.create({
      tableId: tableId.toString(),
      records,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const payload = result._unsafeUnwrap();

    expect(payload.restoredCount).toBe(totalRecords);
    expect(recordRepository.batchSizes).toHaveLength(20);
    expect(new Set(recordRepository.batchSizes)).toEqual(new Set([550]));
    expect(unitOfWork.transactions).toHaveLength(20);
    expect(eventBus.events).toHaveLength(20);
    expect(payload.events).toHaveLength(20);
    const firstEvent = eventBus.events.find(isRecordsBatchCreatedEvent);
    const lastEvent = [...eventBus.events].reverse().find(isRecordsBatchCreatedEvent);
    expect(firstEvent).toBeDefined();
    expect(lastEvent).toBeDefined();
    expect(firstEvent!.records).toHaveLength(550);
    expect(lastEvent!.records).toHaveLength(550);
  });

  it('skips already restored records when replaying undo or redo', async () => {
    const { table, tableId, textFieldId, numberFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new CapturingTableRecordRepository();
    const recordId = `rec${'u'.repeat(14)}01`;
    recordRepository.existingIds.add(recordId);
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new RestoreRecordsHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      createRecordWritePluginRunner()
    );

    const command = RestoreRecordsCommand.create({
      tableId: tableId.toString(),
      records: [
        {
          recordId,
          fields: {
            [textFieldId.toString()]: 'Restored value',
            [numberFieldId.toString()]: 8,
          },
        },
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(
      { ...createContext(), undoRedo: { mode: 'undo', operationId: 'op-restore-1' } },
      command
    );
    const payload = result._unsafeUnwrap();

    expect(payload.restoredCount).toBe(0);
    expect(recordRepository.insertedRecords).toHaveLength(0);
  });

  it('does not restore when a record-write plugin denies the operation', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const recordRepository = new CapturingTableRecordRepository();
    const denyPlugin: IRecordWritePlugin = {
      name: 'deny-restore',
      supports: () => true,
      guard: () =>
        err(
          domainError.forbidden({
            code: 'restore.denied',
            message: 'no access to the target table',
          })
        ),
    };
    const handler = new RestoreRecordsHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      new EventBusDomainWriteTransaction(new FakeUnitOfWork(), new FakeEventBus()),
      createRecordWritePluginRunner([denyPlugin])
    );
    const command = RestoreRecordsCommand.create({
      tableId: tableId.toString(),
      records: [
        {
          recordId: `rec${'d'.repeat(14)}01`,
          fields: { [textFieldId.toString()]: 'denied' },
        },
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('restore.denied');
    expect(recordRepository.insertedRecords).toHaveLength(0);
  });

  it('restores self-referential links atomically in a single batch and reconciles pruned events', async () => {
    const baseId = BaseId.create(`bse${'l'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'l'.repeat(16)}`)._unsafeUnwrap();
    const titleFieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const selfLinkFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('SelfLink Restore')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(titleFieldId)
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(selfLinkFieldId)
      .withName(FieldName.create('Parent')._unsafeUnwrap())
      .withConfig(
        LinkFieldConfig.create({
          relationship: 'manyOne',
          foreignTableId: tableId.toString(),
          lookupFieldId: titleFieldId.toString(),
        })._unsafeUnwrap()
      )
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const parentId = `rec${'p'.repeat(14)}01`;
    const childLiveId = `rec${'c'.repeat(14)}01`;
    const childPurgedId = `rec${'c'.repeat(14)}02`;
    const missingParentId = `rec${'m'.repeat(14)}99`;

    const computedFieldId = `fld${'c'.repeat(16)}`;
    class SelfLinkCapturingRepository extends CapturingTableRecordRepository {
      selfLinkCalls: Array<{
        transaction: IExecutionContext['transaction'];
        records: ReadonlyArray<{
          readonly recordId: RecordId;
          readonly fields: Readonly<Record<string, unknown>>;
        }>;
        options?: RestoreSelfReferentialLinksOptions;
      }> = [];

      async restoreSelfReferentialLinks(
        context: IExecutionContext,
        _table: Table,
        records: ReadonlyArray<{
          readonly recordId: RecordId;
          readonly fields: Readonly<Record<string, unknown>>;
        }>,
        options?: RestoreSelfReferentialLinksOptions
      ): Promise<Result<ReadonlyArray<RestoredSelfReferentialLinkRecord>, DomainError>> {
        this.selfLinkCalls.push({ transaction: context.transaction, records, options });
        const applied: RestoredSelfReferentialLinkRecord[] = [];
        for (const entry of records) {
          const val = entry.fields[selfLinkFieldId.toString()] as { id: string } | undefined;
          if (val?.id === parentId) {
            applied.push({
              recordId: entry.recordId.toString(),
              oldVersion: 1,
              newVersion: 1,
              changes: [{ fieldId: selfLinkFieldId.toString(), oldValue: null, newValue: val }],
              computedChanges: new Map([[computedFieldId, 'Parent-computed']]),
            });
          }
        }
        return ok(applied);
      }
    }

    const recordRepository = new SelfLinkCapturingRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const handler = new RestoreRecordsHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      createRecordWritePluginRunner()
    );

    const command = RestoreRecordsCommand.create({
      tableId: tableId.toString(),
      records: [
        { recordId: parentId, fields: { [titleFieldId.toString()]: 'Parent' } },
        {
          recordId: childLiveId,
          fields: {
            [titleFieldId.toString()]: 'Child Live',
            [selfLinkFieldId.toString()]: { id: parentId, title: 'Parent' },
          },
        },
        {
          recordId: childPurgedId,
          fields: {
            [titleFieldId.toString()]: 'Child Purged',
            [selfLinkFieldId.toString()]: { id: missingParentId, title: 'Gone' },
          },
        },
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result._unsafeUnwrap().restoredCount).toBe(3);
    expect(unitOfWork.transactions).toHaveLength(1);
    expect(recordRepository.insertOptions[0]?.skipComputedUpdates).toBe(true);
    expect(recordRepository.cleanupTrashRecordIds).toEqual([
      [parentId, childLiveId, childPurgedId],
    ]);
    expect(recordRepository.selfLinkCalls).toHaveLength(1);
    expect(recordRepository.selfLinkCalls[0]?.transaction?.kind).toBe('unitOfWorkTransaction');
    expect(recordRepository.selfLinkCalls[0]?.options?.atomicInsertRecords).toHaveLength(3);
    // Phase 1 insertMany stripped all self-link fields before INSERT.
    for (const inserted of recordRepository.insertedRecords) {
      expect(inserted.fields().get(selfLinkFieldId)).toBeUndefined();
    }
    expect(eventBus.events.some(isRecordsBatchUpdatedEvent)).toBe(false);
    const createdEvent = eventBus.events.find(isRecordsBatchCreatedEvent)!;
    const liveEventRecord = createdEvent.records.find((r) => r.recordId === childLiveId)!;
    const purgedEventRecord = createdEvent.records.find((r) => r.recordId === childPurgedId)!;
    expect(liveEventRecord.fields.find((f) => f.fieldId === selfLinkFieldId.toString())).toEqual({
      fieldId: selfLinkFieldId.toString(),
      value: { id: parentId, title: 'Parent' },
    });
    expect(liveEventRecord.fields.find((f) => f.fieldId === computedFieldId)).toEqual({
      fieldId: computedFieldId,
      value: 'Parent-computed',
    });
    expect(
      purgedEventRecord.fields.find((f) => f.fieldId === selfLinkFieldId.toString())
    ).toBeUndefined();
  });

  it('defers trash cleanup for self-linked records across multi-batch restore and recovers on retry', async () => {
    const baseId = BaseId.create(`bse${'m'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'m'.repeat(16)}`)._unsafeUnwrap();
    const titleFieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const selfLinkFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('MultiBatch SelfLink')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(titleFieldId)
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(selfLinkFieldId)
      .withName(FieldName.create('Parent')._unsafeUnwrap())
      .withConfig(
        LinkFieldConfig.create({
          relationship: 'manyOne',
          foreignTableId: tableId.toString(),
          lookupFieldId: titleFieldId.toString(),
        })._unsafeUnwrap()
      )
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const parentId = `rec${'p'.repeat(14)}00`;
    const childId = `rec${'c'.repeat(14)}99`;
    const total = 501;
    const records = Array.from({ length: total }, (_, index) => {
      if (index === 0) {
        return { recordId: parentId, fields: { [titleFieldId.toString()]: 'Root' } };
      }
      if (index === total - 1) {
        return {
          recordId: childId,
          fields: {
            [titleFieldId.toString()]: 'Leaf',
            [selfLinkFieldId.toString()]: { id: parentId, title: 'Root' },
          },
        };
      }
      return {
        recordId: `rec${index.toString().padStart(14, '0')}mn`,
        fields: { [titleFieldId.toString()]: `Row ${index}` },
      };
    });

    class RetryableMultiBatchRepository extends CapturingTableRecordRepository {
      failPhase2Once = true;
      trashedIds = new Set(records.map((r) => r.recordId));
      phase2CleanupIds: string[] = [];

      async listTrashedRecordIds(
        _context: IExecutionContext,
        _table: Table,
        recordIds: ReadonlyArray<string>
      ) {
        return ok(new Set(recordIds.filter((id) => this.trashedIds.has(id))));
      }

      override async insertMany(
        context: IExecutionContext,
        t: Table,
        batchRecords: ReadonlyArray<TableRecord>,
        options?: InsertOptions
      ) {
        for (const record of batchRecords) {
          this.existingIds.add(record.id().toString());
        }
        for (const cleanedId of options?.cleanupTrashRecordIds ?? []) {
          this.trashedIds.delete(cleanedId);
        }
        return super.insertMany(context, t, batchRecords, options);
      }

      async restoreSelfReferentialLinks(
        _context: IExecutionContext,
        _table: Table,
        linkRecords: ReadonlyArray<{
          readonly recordId: RecordId;
          readonly fields: Readonly<Record<string, unknown>>;
        }>,
        options?: RestoreSelfReferentialLinksOptions
      ): Promise<Result<ReadonlyArray<RestoredSelfReferentialLinkRecord>, DomainError>> {
        if (this.failPhase2Once) {
          this.failPhase2Once = false;
          return err(domainError.unexpected({ message: 'phase 2 transient error' }));
        }
        for (const id of options?.cleanupTrashRecordIds ?? []) {
          this.phase2CleanupIds.push(id);
          this.trashedIds.delete(id);
        }
        return ok(
          linkRecords.map((entry) => ({
            recordId: entry.recordId.toString(),
            oldVersion: 1,
            newVersion: 2,
            changes: [
              {
                fieldId: selfLinkFieldId.toString(),
                oldValue: null,
                newValue: entry.fields[selfLinkFieldId.toString()],
              },
            ],
          }))
        );
      }
    }

    const recordRepository = new RetryableMultiBatchRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const handler = new RestoreRecordsHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      new EventBusDomainWriteTransaction(unitOfWork, eventBus),
      createRecordWritePluginRunner()
    );
    const replayContext: IExecutionContext = {
      ...createContext(),
      undoRedo: { mode: 'undo', operationId: 'op-retry-self-link' },
    };

    const command = RestoreRecordsCommand.create(
      { tableId: tableId.toString(), records },
      { requireTrashRowReason: 'deleted' }
    )._unsafeUnwrap();

    const firstAttempt = await handler.handle(replayContext, command);
    expect(firstAttempt.isErr()).toBe(true);
    // Child record keeps its trash row when Phase 2 fails so retry preserves its self-link.
    expect(recordRepository.cleanupTrashRecordIds[1]).toEqual([]);
    expect(recordRepository.trashedIds.has(childId)).toBe(true);

    const retryAttempt = await handler.handle(replayContext, command);
    const retryPayload = retryAttempt._unsafeUnwrap();
    expect(retryPayload.restoredCount).toBe(0);
    expect(recordRepository.phase2CleanupIds).toEqual([childId]);
    expect(recordRepository.trashedIds.size).toBe(0);
    const updatedEvent = retryPayload.events.find(isRecordsBatchUpdatedEvent);
    expect(updatedEvent?.source).toBe('computed');
    expect(updatedEvent?.updates).toHaveLength(1);
    expect(updatedEvent?.updates[0]?.recordId).toBe(childId);
    expect(updatedEvent?.updates[0]?.oldVersion).toBe(1);
    expect(updatedEvent?.updates[0]?.newVersion).toBe(2);
  });
});
