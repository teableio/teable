import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import type { FieldUpdateSideEffectService } from '../application/services/FieldUpdateSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableFieldLimitFieldOperationPlugin } from '../application/services/TableFieldLimitFieldOperationPlugin';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoService } from '../application/services/UndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldUpdated } from '../domain/table/events/FieldUpdated';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { SingleLineTextField } from '../domain/table/fields/types/SingleLineTextField';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TABLE_FIELD_LIMIT_ERROR_CODE } from '../domain/table/TableFieldLimit';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import { FieldOperationKind } from '../ports/FieldOperationPlugin';
import { DefaultTableMapper } from '../ports/mappers/defaults/DefaultTableMapper';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository, TableUpdatePersistResult } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import {
  createFieldOperationPluginRunner,
  createTrackedFieldOperationPlugin,
  expectFieldOperationPluginToBeSkipped,
} from './fieldOperationPluginRunnerTestUtils';
import { UpdateFieldCommand } from './UpdateFieldCommand';
import { UpdateFieldHandler } from './UpdateFieldHandler';

const createContext = (options?: {
  maxFieldsPerTable?: number;
  t?: NonNullable<IExecutionContext['$t']>;
}): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
  config:
    options?.maxFieldsPerTable == null
      ? undefined
      : {
          tableFields: {
            maxFieldsPerTable: options.maxFieldsPerTable,
          },
        },
  $t: options?.t,
});

const noopUndoRedoService = {
  async recordEntry() {
    return ok(undefined);
  },
} as unknown as UndoRedoService;

const noopFieldUndoRedoSnapshotService = {
  async capture(_context: IExecutionContext, _table: Table, fieldId: FieldId) {
    return ok({
      field: {
        id: fieldId.toString(),
        name: 'Undo Snapshot',
        type: 'singleLineText',
      },
      views: [],
      records: [],
    });
  },
} as unknown as FieldUndoRedoSnapshotService;

const buildTable = () => {
  const baseId = BaseId.create(`bse${'u'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Update Fields')._unsafeUnwrap();
  const fieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withId(fieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    baseId,
    tableId,
    fieldId,
  };
};

let generatedFieldCounter = 0;

const createGeneratedField = (name: string) =>
  (() => {
    const field = SingleLineTextField.create({
      id: FieldId.create(
        `fld${(generatedFieldCounter++).toString(36).padStart(16, '0')}`
      )._unsafeUnwrap(),
      name: FieldName.create(name)._unsafeUnwrap(),
    })._unsafeUnwrap();
    field
      .setDbFieldName(DbFieldName.rehydrate(field.id().toString())._unsafeUnwrap())
      ._unsafeUnwrap();
    return field;
  })();

const addTextFields = (table: Table, count: number, prefix: string): Table => {
  let currentTable = table;
  for (let index = 0; index < count; index += 1) {
    currentTable = currentTable
      .update((mutator) => mutator.addField(createGeneratedField(`${prefix} ${index + 1}`)))
      ._unsafeUnwrap().table;
  }
  return currentTable;
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  nextUpdateResult: TableUpdatePersistResult | void = undefined;

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
    table: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<TableUpdatePersistResult | void, DomainError>> {
    const index = this.tables.findIndex((entry) => entry.id().equals(table.id()));
    if (index >= 0) {
      this.tables[index] = table;
    }
    return ok(this.nextUpdateResult);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
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
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];

  async publish(_: IExecutionContext, event: IDomainEvent): Promise<Result<void, DomainError>> {
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(
    _: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    this.published.push(...events);
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

const tableMapper = new DefaultTableMapper();

describe('UpdateFieldHandler', () => {
  it('does not publish record update events after type conversion', async () => {
    const { table, tableId, fieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const eventBus = new FakeEventBus();

    const handler = new UpdateFieldHandler(
      tableRepository,
      tableMapper,
      new TableUpdateFlow(
        tableRepository,
        new FakeTableSchemaRepository(),
        eventBus,
        new FakeUnitOfWork()
      ),
      {
        async prepare() {
          return ok([]);
        },
        async execute(_context: IExecutionContext, input: { table: Table }) {
          return ok({ specs: [], updatedTable: input.table, events: [] });
        },
      } as unknown as FieldUpdateSideEffectService,
      {
        async load() {
          return ok([]);
        },
      } as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    const command = UpdateFieldCommand.create({
      tableId: tableId.toString(),
      fieldId: fieldId.toString(),
      field: {
        type: 'number',
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(eventBus.published).toHaveLength(1);
    expect(eventBus.published[0]).toBeInstanceOf(FieldUpdated);
  });

  it('returns an explicit no-op validation error for normal update commands', async () => {
    const { table, tableId, fieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const eventBus = new FakeEventBus();

    const handler = new UpdateFieldHandler(
      tableRepository,
      tableMapper,
      new TableUpdateFlow(
        tableRepository,
        new FakeTableSchemaRepository(),
        eventBus,
        new FakeUnitOfWork()
      ),
      {
        async prepare() {
          return ok([]);
        },
        async execute(_context: IExecutionContext, input: { table: Table }) {
          return ok({ specs: [], updatedTable: input.table, events: [] });
        },
      } as unknown as FieldUpdateSideEffectService,
      {
        async load() {
          return ok([]);
        },
      } as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    const command = UpdateFieldCommand.create({
      tableId: tableId.toString(),
      fieldId: fieldId.toString(),
      field: {
        type: 'singleLineText',
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('No changes to apply');
    }
    expect(eventBus.published).toHaveLength(0);
  });

  it('allows no-op update commands when explicitly marked as replay-safe', async () => {
    const { table, tableId, fieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const eventBus = new FakeEventBus();

    const handler = new UpdateFieldHandler(
      tableRepository,
      tableMapper,
      new TableUpdateFlow(
        tableRepository,
        new FakeTableSchemaRepository(),
        eventBus,
        new FakeUnitOfWork()
      ),
      {
        async prepare() {
          return ok([]);
        },
        async execute(_context: IExecutionContext, input: { table: Table }) {
          return ok({ specs: [], updatedTable: input.table, events: [] });
        },
      } as unknown as FieldUpdateSideEffectService,
      {
        async load() {
          return ok([]);
        },
      } as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    const command = UpdateFieldCommand.create(
      {
        tableId: tableId.toString(),
        fieldId: fieldId.toString(),
        field: {
          type: 'singleLineText',
        },
      },
      {
        allowNoop: true,
      }
    )._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(eventBus.published).toHaveLength(0);
  });

  it('injects sequential field versions into FieldUpdated events from table update flow', async () => {
    const { table, tableId, fieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    tableRepository.nextUpdateResult = {
      fieldVersionChanges: [
        {
          fieldId: fieldId.toString(),
          oldVersion: 3,
          newVersion: 4,
        },
        {
          fieldId: fieldId.toString(),
          oldVersion: 4,
          newVersion: 5,
        },
      ],
    };

    const eventBus = new FakeEventBus();

    const handler = new UpdateFieldHandler(
      tableRepository,
      tableMapper,
      new TableUpdateFlow(
        tableRepository,
        new FakeTableSchemaRepository(),
        eventBus,
        new FakeUnitOfWork()
      ),
      {
        async prepare() {
          return ok([]);
        },
        async execute(_context: IExecutionContext, input: { table: Table }) {
          return ok({ specs: [], updatedTable: input.table, events: [] });
        },
      } as unknown as FieldUpdateSideEffectService,
      {
        async load() {
          return ok([]);
        },
      } as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    const command = UpdateFieldCommand.create({
      tableId: tableId.toString(),
      fieldId: fieldId.toString(),
      field: {
        name: 'Renamed',
        description: 'Desc',
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);

    const fieldEvents = eventBus.published.filter(
      (event): event is FieldUpdated => event instanceof FieldUpdated
    );
    expect(fieldEvents).toHaveLength(2);
    expect(fieldEvents[0]?.oldVersion).toBe(3);
    expect(fieldEvents[0]?.newVersion).toBe(4);
    expect(fieldEvents[1]?.oldVersion).toBe(4);
    expect(fieldEvents[1]?.newVersion).toBe(5);
  });

  it('captures the old field snapshot before preview planning mutates constraints', async () => {
    const { table, tableId } = buildTable();
    const targetField = createGeneratedField('Secondary');
    const tableWithTargetField = table
      .update((mutator) => mutator.addField(targetField))
      ._unsafeUnwrap().table;
    const fieldId = targetField.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(tableWithTargetField);

    const capturedUniqueStates: boolean[] = [];
    const snapshotService = {
      async capture(_context: IExecutionContext, sourceTable: Table, sourceFieldId: FieldId) {
        const field = sourceTable.getField((candidate) => candidate.id().equals(sourceFieldId));
        if (field.isErr()) {
          return err(field.error);
        }

        const unique = field.value.unique().toBoolean();
        capturedUniqueStates.push(unique);

        return ok({
          field: {
            id: sourceFieldId.toString(),
            name: field.value.name().toString(),
            type: 'singleLineText',
            unique,
          },
          views: [],
          records: [],
        });
      },
    } as unknown as FieldUndoRedoSnapshotService;

    const handler = new UpdateFieldHandler(
      tableRepository,
      tableMapper,
      new TableUpdateFlow(
        tableRepository,
        new FakeTableSchemaRepository(),
        new FakeEventBus(),
        new FakeUnitOfWork()
      ),
      {
        async prepare() {
          return ok([]);
        },
        async execute(_context: IExecutionContext, input: { table: Table }) {
          return ok({ specs: [], updatedTable: input.table, events: [] });
        },
      } as unknown as FieldUpdateSideEffectService,
      {
        async load() {
          return ok([]);
        },
      } as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      snapshotService
    );

    const command = UpdateFieldCommand.create({
      tableId: tableId.toString(),
      fieldId: fieldId.toString(),
      field: {
        unique: true,
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(capturedUniqueStates).toEqual([false, true]);
  });

  it('returns a validation error when link conversion would exceed the foreign table field limit', async () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const hostTableId = `tbl${'b'.repeat(16)}`;
    const foreignTableId = `tbl${'c'.repeat(16)}`;
    const hostPrimaryId = `fld${'d'.repeat(16)}`;
    const sourceFieldId = `fld${'e'.repeat(16)}`;
    const foreignPrimaryId = `fld${'f'.repeat(16)}`;

    const hostTable = Table.builder()
      .withId(TableId.create(hostTableId)._unsafeUnwrap())
      .withBaseId(BaseId.create(baseId)._unsafeUnwrap())
      .withName(TableName.create('Host')._unsafeUnwrap())
      .field()
      .singleLineText()
      .withId(FieldId.create(hostPrimaryId)._unsafeUnwrap())
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done()
      .field()
      .singleLineText()
      .withId(FieldId.create(sourceFieldId)._unsafeUnwrap())
      .withName(FieldName.create('Link Source')._unsafeUnwrap())
      .done()
      .view()
      .defaultGrid()
      .done()
      .build()
      ._unsafeUnwrap();

    const foreignTable = addTextFields(
      Table.builder()
        .withId(TableId.create(foreignTableId)._unsafeUnwrap())
        .withBaseId(BaseId.create(baseId)._unsafeUnwrap())
        .withName(TableName.create('Foreign')._unsafeUnwrap())
        .field()
        .singleLineText()
        .withId(FieldId.create(foreignPrimaryId)._unsafeUnwrap())
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done()
        .view()
        .defaultGrid()
        .done()
        .build()
        ._unsafeUnwrap(),
      2,
      'Foreign Extra'
    );

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(hostTable, foreignTable);

    const handler = new UpdateFieldHandler(
      tableRepository,
      tableMapper,
      new TableUpdateFlow(
        tableRepository,
        new FakeTableSchemaRepository(),
        new FakeEventBus(),
        new FakeUnitOfWork()
      ),
      {
        async prepare() {
          return ok([]);
        },
        async execute(_context: IExecutionContext, input: { table: Table }) {
          return ok({ specs: [], updatedTable: input.table, events: [] });
        },
      } as unknown as FieldUpdateSideEffectService,
      new ForeignTableLoaderService(tableRepository),
      createFieldOperationPluginRunner([new TableFieldLimitFieldOperationPlugin()]),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    const command = UpdateFieldCommand.create({
      tableId: hostTableId,
      fieldId: sourceFieldId,
      field: {
        type: 'link',
        name: 'Projects',
        options: {
          relationship: 'manyMany',
          foreignTableId,
          lookupFieldId: foreignPrimaryId,
        },
      },
    })._unsafeUnwrap();

    const result = await handler.handle(
      createContext({
        maxFieldsPerTable: 3,
        t: (_key, options) =>
          `limit:${String(options?.maxFieldCount)} table:${String(options?.tableName)}`,
      }),
      command
    );

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }

    expect(result.error.code).toBe(TABLE_FIELD_LIMIT_ERROR_CODE);
    expect(result.error.message).toContain('limit:3');
    expect(result.error.message).toContain('table:Foreign');
    expect(result.error.details).toMatchObject({
      tableName: 'Foreign',
      currentFieldCount: 3,
      attemptedFieldCount: 4,
      maxFieldCount: 3,
    });
  });

  it('runs create plugins for reciprocal side-effect targets during link conversion', async () => {
    const baseId = `bse${'g'.repeat(16)}`;
    const hostTableId = `tbl${'h'.repeat(16)}`;
    const foreignTableId = `tbl${'i'.repeat(16)}`;
    const hostPrimaryId = `fld${'j'.repeat(16)}`;
    const sourceFieldId = `fld${'k'.repeat(16)}`;
    const foreignPrimaryId = `fld${'l'.repeat(16)}`;

    const hostTable = Table.builder()
      .withId(TableId.create(hostTableId)._unsafeUnwrap())
      .withBaseId(BaseId.create(baseId)._unsafeUnwrap())
      .withName(TableName.create('Host')._unsafeUnwrap())
      .field()
      .singleLineText()
      .withId(FieldId.create(hostPrimaryId)._unsafeUnwrap())
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done()
      .field()
      .singleLineText()
      .withId(FieldId.create(sourceFieldId)._unsafeUnwrap())
      .withName(FieldName.create('Link Source')._unsafeUnwrap())
      .done()
      .view()
      .defaultGrid()
      .done()
      .build()
      ._unsafeUnwrap();

    const foreignTable = Table.builder()
      .withId(TableId.create(foreignTableId)._unsafeUnwrap())
      .withBaseId(BaseId.create(baseId)._unsafeUnwrap())
      .withName(TableName.create('Foreign')._unsafeUnwrap())
      .field()
      .singleLineText()
      .withId(FieldId.create(foreignPrimaryId)._unsafeUnwrap())
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done()
      .view()
      .defaultGrid()
      .done()
      .build()
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(hostTable, foreignTable);
    const { plugin, calls } = createTrackedFieldOperationPlugin([FieldOperationKind.create]);

    const handler = new UpdateFieldHandler(
      tableRepository,
      tableMapper,
      new TableUpdateFlow(
        tableRepository,
        new FakeTableSchemaRepository(),
        new FakeEventBus(),
        new FakeUnitOfWork()
      ),
      {
        async prepare() {
          return ok([]);
        },
        async execute(_context: IExecutionContext, input: { table: Table }) {
          return ok({ specs: [], updatedTable: input.table, events: [] });
        },
      } as unknown as FieldUpdateSideEffectService,
      new ForeignTableLoaderService(tableRepository),
      createFieldOperationPluginRunner([plugin]),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    const command = UpdateFieldCommand.create({
      tableId: hostTableId,
      fieldId: sourceFieldId,
      field: {
        type: 'link',
        name: 'Projects',
        options: {
          relationship: 'manyMany',
          foreignTableId,
          lookupFieldId: foreignPrimaryId,
        },
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(calls.supports).toEqual([FieldOperationKind.update, FieldOperationKind.create]);
    expect(calls.prepare).toHaveLength(1);
    expect(calls.guard).toHaveLength(1);
    expect(calls.beforePersist).toHaveLength(1);
    expect(calls.afterCommit).toHaveLength(1);
    expect(calls.prepare[0]?.kind).toBe(FieldOperationKind.create);
    expect(calls.prepare[0]?.table.id().toString()).toBe(foreignTableId);
    expect(calls.prepare[0]?.target.kind).toBe('sideEffect');
    expect(calls.prepare[0]?.target.sourceOperation).toBe(FieldOperationKind.update);
    expect(calls.prepare[0]?.target.sourceTable.id().toString()).toBe(hostTableId);
  });

  it('skips plugins that do not support update', async () => {
    const { table, tableId, fieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const eventBus = new FakeEventBus();
    const { plugin, calls } = createTrackedFieldOperationPlugin([FieldOperationKind.create]);

    const handler = new UpdateFieldHandler(
      tableRepository,
      tableMapper,
      new TableUpdateFlow(
        tableRepository,
        new FakeTableSchemaRepository(),
        eventBus,
        new FakeUnitOfWork()
      ),
      {
        async prepare() {
          return ok([]);
        },
        async execute(_context: IExecutionContext, input: { table: Table }) {
          return ok({ specs: [], updatedTable: input.table, events: [] });
        },
      } as unknown as FieldUpdateSideEffectService,
      {
        async load() {
          return ok([]);
        },
      } as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner([plugin]),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    const command = UpdateFieldCommand.create({
      tableId: tableId.toString(),
      fieldId: fieldId.toString(),
      field: {
        name: 'Renamed',
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expectFieldOperationPluginToBeSkipped(calls, FieldOperationKind.update);
  });
});
