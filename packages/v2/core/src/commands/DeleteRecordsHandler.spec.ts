import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableQueryService } from '../application/services/TableQueryService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { RecordsDeleted } from '../domain/table/events/RecordsDeleted';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
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
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRecordRepository } from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { DeleteRecordsCommand } from './DeleteRecordsCommand';
import { DeleteRecordsHandler } from './DeleteRecordsHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Records Table')._unsafeUnwrap();
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

  return { table: builder.build()._unsafeUnwrap(), baseId, tableId };
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
  lastContext: IExecutionContext | undefined;
  lastTable: Table | undefined;
  lastSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined;
  failDelete: DomainError | undefined;

  async insert(
    _: IExecutionContext,
    __: Table,
    ___: TableRecord
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _: IExecutionContext,
    __: Table,
    ___: ReadonlyArray<TableRecord>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertManyStream(
    _: IExecutionContext,
    __: Table,
    ___: Iterable<ReadonlyArray<TableRecord>>
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    return ok({ totalInserted: 0 });
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId,
    ____: ICellValueSpec
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async deleteMany(
    context: IExecutionContext,
    table: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    this.lastContext = context;
    this.lastTable = table;
    this.lastSpec = spec;
    if (this.failDelete) return err(this.failDelete);
    return ok(undefined);
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

describe('DeleteRecordsHandler', () => {
  it('deletes records and publishes event', async () => {
    const { table, tableId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const handler = new DeleteRecordsHandler(
      new TableQueryService(tableRepository),
      new FakeTableRecordRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const commandResult = DeleteRecordsCommand.create({
      tableId: tableId.toString(),
      recordIds: [`rec${'a'.repeat(16)}`, `rec${'b'.repeat(16)}`],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.deletedRecordIds).toHaveLength(2);
    expect(payload.events.some((event) => event instanceof RecordsDeleted)).toBe(true);
  });

  it('continues when delete returns not found', async () => {
    const { table, tableId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const recordRepository = new FakeTableRecordRepository();
    recordRepository.failDelete = domainError.notFound({ message: 'Record missing' });
    const eventBus = new FakeEventBus();

    const handler = new DeleteRecordsHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      eventBus,
      new FakeUnitOfWork()
    );

    const commandResult = DeleteRecordsCommand.create({
      tableId: tableId.toString(),
      recordIds: [`rec${'c'.repeat(16)}`],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(eventBus.published.length).toBe(1);
  });

  it('returns error when delete fails', async () => {
    const { table, tableId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const recordRepository = new FakeTableRecordRepository();
    recordRepository.failDelete = domainError.unexpected({ message: 'delete failed' });

    const handler = new DeleteRecordsHandler(
      new TableQueryService(tableRepository),
      recordRepository,
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const commandResult = DeleteRecordsCommand.create({
      tableId: tableId.toString(),
      recordIds: [`rec${'d'.repeat(16)}`],
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('delete failed');
  });
});
