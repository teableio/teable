import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import type { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { DomainEventName } from '../domain/shared/DomainEventName';
import { OccurredAt } from '../domain/shared/OccurredAt';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { DeleteFieldCommand } from './DeleteFieldCommand';
import { DeleteFieldHandler } from './DeleteFieldHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'e'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Fields Table')._unsafeUnwrap();
  const primaryFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
  const secondaryFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withId(primaryFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(secondaryFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    baseId,
    tableId,
    primaryFieldId,
    secondaryFieldId,
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
    __: ISpecification<Table, ITableSpecVisitor>,
    ___?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables);
  }

  async updateOne(
    _: IExecutionContext,
    table: Table,
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    this.updated.push(table);
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  updated: Table[] = [];

  async insert(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _: IExecutionContext,
    __: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async update(
    _: IExecutionContext,
    table: Table,
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    this.updated.push(table);
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
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

class FakeFieldDeletionSideEffectService {
  calls: Array<{ table: Table; fields: ReadonlyArray<FieldId> }> = [];
  events: IDomainEvent[] = [];

  async execute(
    _: IExecutionContext,
    input: { table: Table; fields: ReadonlyArray<{ id: () => FieldId }>; foreignTables: Table[] }
  ): Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>> {
    this.calls.push({
      table: input.table,
      fields: input.fields.map((field) => field.id()),
    });
    return ok([...this.events]);
  }
}

class FakeForeignTableLoaderService {
  lastBaseId: BaseId | undefined;
  lastReferences: unknown[] | undefined;

  async load(
    _: IExecutionContext,
    input: { baseId: BaseId; references: ReadonlyArray<unknown> }
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    this.lastBaseId = input.baseId;
    this.lastReferences = [...input.references];
    return ok([]);
  }
}

const buildEvent = (): IDomainEvent => ({
  name: DomainEventName.fieldDeleted(),
  occurredAt: OccurredAt.now(),
});

describe('DeleteFieldHandler', () => {
  it('deletes a field and runs side effects', async () => {
    const { table, baseId, tableId, secondaryFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );

    const sideEffectService = new FakeFieldDeletionSideEffectService();
    sideEffectService.events = [buildEvent()];

    const foreignTableLoader = new FakeForeignTableLoaderService();

    const handler = new DeleteFieldHandler(
      tableRepository,
      tableUpdateFlow,
      sideEffectService as unknown as FieldDeletionSideEffectService,
      foreignTableLoader as unknown as ForeignTableLoaderService
    );

    const commandResult = DeleteFieldCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      fieldId: secondaryFieldId.toString(),
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.table.getFields((field) => field.id().equals(secondaryFieldId))).toHaveLength(0);
    expect(sideEffectService.calls.length).toBe(1);
    expect(sideEffectService.calls[0]?.fields[0]?.equals(secondaryFieldId)).toBe(true);
    expect(eventBus.published.length).toBeGreaterThan(0);
    expect(unitOfWork.transactions.length).toBe(1);
    expect(foreignTableLoader.lastBaseId?.equals(baseId)).toBe(true);
  });

  it('returns not found when field is missing', async () => {
    const { table, baseId, tableId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const handler = new DeleteFieldHandler(
      tableRepository,
      new TableUpdateFlow(
        tableRepository,
        new FakeTableSchemaRepository(),
        new FakeEventBus(),
        new FakeUnitOfWork()
      ),
      new FakeFieldDeletionSideEffectService() as unknown as FieldDeletionSideEffectService,
      new FakeForeignTableLoaderService() as unknown as ForeignTableLoaderService
    );

    const commandResult = DeleteFieldCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      fieldId: `fld${'x'.repeat(16)}`,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('Field not found');
  });
});
