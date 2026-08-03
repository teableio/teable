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
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import { NoopTableRecordRepository } from '../ports/defaults/NoopTableRecordRepository';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import { type IFindOptions } from '../ports/RepositoryQuery';
import type { InsertOptions } from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { RestoreRecordsCommand } from './RestoreRecordsCommand';
import { RestoreRecordsHandler } from './RestoreRecordsHandler';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

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
  insertedRecords: TableRecord[] = [];
  transactionKinds: Array<IExecutionContext['transaction']> = [];

  override async insertMany(
    context: IExecutionContext,
    _: Table,
    records: ReadonlyArray<TableRecord>,
    options?: InsertOptions
  ) {
    this.batchSizes.push(records.length);
    this.restoreMaps.push(new Map(options?.restoreRecordsById ?? []));
    this.cleanupTrashRecordIds.push([...(options?.cleanupTrashRecordIds ?? [])]);
    this.insertedRecords.push(...records);
    this.transactionKinds.push(context.transaction);
    return ok({});
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
      eventBus,
      unitOfWork
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
      eventBus,
      unitOfWork
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
      eventBus,
      unitOfWork
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
});
