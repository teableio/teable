import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import type { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import type { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoService } from '../application/services/UndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { DomainEventName } from '../domain/shared/DomainEventName';
import { OccurredAt } from '../domain/shared/OccurredAt';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkField } from '../domain/table/fields/types/LinkField';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import { FieldOperationKind } from '../ports/FieldOperationPlugin';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { DeleteFieldCommand } from './DeleteFieldCommand';
import { DeleteFieldHandler } from './DeleteFieldHandler';
import {
  createFieldOperationPluginRunner,
  createTrackedFieldOperationPlugin,
  expectFieldOperationPluginToBeSkipped,
} from './fieldOperationPluginRunnerTestUtils';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const noopUndoRedoService = {
  async recordEntry() {
    return ok(undefined);
  },
} as unknown as UndoRedoService;

class FakeFieldUndoRedoSnapshotService {
  captured: Array<{ tableId: TableId; fieldId: FieldId; includeRecords?: boolean }> = [];

  async capture(
    _context: IExecutionContext,
    table: Table,
    fieldId: FieldId,
    options?: { includeRecords?: boolean }
  ) {
    this.captured.push({
      tableId: table.id(),
      fieldId,
      includeRecords: options?.includeRecords,
    });
    return ok({
      field: {
        id: fieldId.toString(),
        name: 'Undo Snapshot',
        type: 'singleLineText',
      },
      views: [],
    });
  }
}

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
  ): Promise<Result<Table, DomainError>> {
    this.updated.push(table);
    return ok(table);
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
  ): Promise<Result<{ events: ReadonlyArray<IDomainEvent>; appliedDeletions: [] }, DomainError>> {
    this.calls.push({
      table: input.table,
      fields: input.fields.map((field) => field.id()),
    });
    return ok({ events: [...this.events], appliedDeletions: [] });
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
    const fieldUndoRedoSnapshotService = new FakeFieldUndoRedoSnapshotService();

    const handler = new DeleteFieldHandler(
      tableRepository,
      tableUpdateFlow,
      sideEffectService as unknown as FieldDeletionSideEffectService,
      foreignTableLoader as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      fieldUndoRedoSnapshotService as unknown as FieldUndoRedoSnapshotService
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
    expect(fieldUndoRedoSnapshotService.captured).toHaveLength(1);
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
      new FakeForeignTableLoaderService() as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      new FakeFieldUndoRedoSnapshotService() as unknown as FieldUndoRedoSnapshotService
    );

    const commandResult = DeleteFieldCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      fieldId: `fld${'x'.repeat(16)}`,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('Field not found');
  });

  it('captures related undo snapshots from explicit field deletion reactions', async () => {
    const baseId = BaseId.create(`bse${'f'.repeat(16)}`)._unsafeUnwrap();
    const sourceTableId = TableId.create(`tbl${'g'.repeat(16)}`)._unsafeUnwrap();
    const hostTableId = TableId.create(`tbl${'h'.repeat(16)}`)._unsafeUnwrap();
    const sourcePrimaryFieldId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();
    const sourceDisplayFieldId = FieldId.create(`fld${'j'.repeat(16)}`)._unsafeUnwrap();
    const hostPrimaryFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();
    const hostLinkFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();

    const sourceBuilder = Table.builder()
      .withId(sourceTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Source')._unsafeUnwrap());
    sourceBuilder
      .field()
      .singleLineText()
      .withId(sourcePrimaryFieldId)
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    sourceBuilder
      .field()
      .singleLineText()
      .withId(sourceDisplayFieldId)
      .withName(FieldName.create('Display')._unsafeUnwrap())
      .done();
    sourceBuilder.view().defaultGrid().done();
    const sourceTable = sourceBuilder.build()._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withId(hostTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryFieldId)
      .withName(FieldName.create('Host Title')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostBaseTable = hostBuilder.build()._unsafeUnwrap();

    const hostLinkField = LinkField.create({
      id: hostLinkFieldId,
      name: FieldName.create('Source Link')._unsafeUnwrap(),
      config: LinkFieldConfig.create({
        relationship: 'oneOne',
        foreignTableId: sourceTableId.toString(),
        lookupFieldId: sourceDisplayFieldId.toString(),
        isOneWay: true,
        fkHostTableName: 'host_source_link',
        selfKeyName: '__id',
        foreignKeyName: '__fk_source_link',
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    const hostTable = hostBaseTable
      .addField(hostLinkField, { foreignTables: [sourceTable] })
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(sourceTable, hostTable);

    const snapshotService = new FakeFieldUndoRedoSnapshotService();
    const handlerWithSnapshots = new DeleteFieldHandler(
      tableRepository,
      new TableUpdateFlow(
        tableRepository,
        new FakeTableSchemaRepository(),
        new FakeEventBus(),
        new FakeUnitOfWork()
      ),
      new FakeFieldDeletionSideEffectService() as unknown as FieldDeletionSideEffectService,
      new FakeForeignTableLoaderService() as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      snapshotService as unknown as FieldUndoRedoSnapshotService
    );

    const command = DeleteFieldCommand.create({
      baseId: baseId.toString(),
      tableId: sourceTableId.toString(),
      fieldId: sourceDisplayFieldId.toString(),
    })._unsafeUnwrap();

    const result = await handlerWithSnapshots.handle(createContext(), command);
    expect(result.isOk()).toBe(true);

    expect(
      snapshotService.captured.map(({ tableId, fieldId, includeRecords }) => ({
        tableId: tableId.toString(),
        fieldId: fieldId.toString(),
        includeRecords,
      }))
    ).toEqual([
      {
        tableId: sourceTableId.toString(),
        fieldId: sourceDisplayFieldId.toString(),
        includeRecords: undefined,
      },
      {
        tableId: hostTableId.toString(),
        fieldId: hostLinkFieldId.toString(),
        includeRecords: false,
      },
    ]);
  });

  it('skips plugins that do not support delete', async () => {
    const { table, baseId, tableId, secondaryFieldId } = buildTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );
    const sideEffectService = new FakeFieldDeletionSideEffectService();
    const foreignTableLoader = new FakeForeignTableLoaderService();
    const fieldUndoRedoSnapshotService = new FakeFieldUndoRedoSnapshotService();
    const { plugin, calls } = createTrackedFieldOperationPlugin([FieldOperationKind.create]);

    const handler = new DeleteFieldHandler(
      tableRepository,
      tableUpdateFlow,
      sideEffectService as unknown as FieldDeletionSideEffectService,
      foreignTableLoader as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner([plugin]),
      noopUndoRedoService,
      fieldUndoRedoSnapshotService as unknown as FieldUndoRedoSnapshotService
    );

    const command = DeleteFieldCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      fieldId: secondaryFieldId.toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expectFieldOperationPluginToBeSkipped(calls, FieldOperationKind.delete);
  });
});
