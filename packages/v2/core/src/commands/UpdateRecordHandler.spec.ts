import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { LinkTitleResolverService } from '../application/services/LinkTitleResolverService';
import { TableQueryService } from '../application/services/TableQueryService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { RecordUpdated } from '../domain/table/events/RecordUpdated';
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
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type { ITableRecordRepository } from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { UpdateRecordCommand } from './UpdateRecordCommand';
import { UpdateRecordHandler } from './UpdateRecordHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'u'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Update Records')._unsafeUnwrap();
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

  return { table: builder.build()._unsafeUnwrap(), baseId, tableId, textFieldId, numberFieldId };
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
  lastRecordId: RecordId | undefined;
  lastMutateSpec: ICellValueSpec | undefined;

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
    context: IExecutionContext,
    _: Table,
    recordId: RecordId,
    mutateSpec: ICellValueSpec
  ): Promise<Result<void, DomainError>> {
    this.lastContext = context;
    this.lastRecordId = recordId;
    this.lastMutateSpec = mutateSpec;
    return ok(undefined);
  }

  async deleteMany(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  record: TableRecordReadModel | undefined;
  failFindOne: DomainError | undefined;

  async find(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>> {
    return ok({ records: [], total: 0 });
  }

  async findOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    if (this.failFindOne) return err(this.failFindOne);
    if (!this.record) return err(domainError.notFound({ message: 'Record not found' }));
    return ok(this.record);
  }
}

class FakeLinkTitleResolverService {
  needsResolutionValue = false;
  resolveCalls: ICellValueSpec[] = [];

  needsResolution(_: ICellValueSpec): boolean {
    return this.needsResolutionValue;
  }

  async resolveAndReplace(
    _: IExecutionContext,
    spec: ICellValueSpec
  ): Promise<Result<ICellValueSpec, DomainError>> {
    this.resolveCalls.push(spec);
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

describe('UpdateRecordHandler', () => {
  it('updates record and publishes event', async () => {
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
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new UpdateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeLinkTitleResolverService() as unknown as LinkTitleResolverService,
      eventBus,
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
    expect(recordRepository.lastRecordId?.equals(recordResult.record.id())).toBe(true);
    expect(recordRepository.lastContext?.transaction?.kind).toBe('unitOfWorkTransaction');
    expect(eventBus.published.some((event) => event instanceof RecordUpdated)).toBe(true);
    expect(unitOfWork.transactions.length).toBe(1);
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
    };

    const resolver = new FakeLinkTitleResolverService();
    resolver.needsResolutionValue = true;

    const handler = new UpdateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      resolver as unknown as LinkTitleResolverService,
      new FakeEventBus(),
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

  it('returns error when record query fails', async () => {
    const { table, tableId, textFieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.failFindOne = domainError.notFound({ message: 'Record missing' });

    const handler = new UpdateRecordHandler(
      tableQueryService,
      new FakeTableRecordRepository(),
      recordQueryRepository,
      new FakeLinkTitleResolverService() as unknown as LinkTitleResolverService,
      new FakeEventBus(),
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
});
