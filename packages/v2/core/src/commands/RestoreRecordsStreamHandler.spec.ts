import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

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
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import { type IFindOptions } from '../ports/RepositoryQuery';
import {
  isInsertManyStreamBatch,
  type InsertManyStreamBatchInput,
  type InsertManyStreamOptions,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
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

describe('RestoreRecordsStreamHandler', () => {
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
      unitOfWork
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
      unitOfWork
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
