import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import type { FieldUpdateSideEffectService } from '../application/services/FieldUpdateSideEffectService';
import type { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoService } from '../application/services/UndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldUpdated } from '../domain/table/events/FieldUpdated';
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
import type { ITableRepository, TableUpdatePersistResult } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { UpdateFieldCommand } from './UpdateFieldCommand';
import { UpdateFieldHandler } from './UpdateFieldHandler';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
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
    tableId,
    fieldId,
  };
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
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
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

describe('UpdateFieldHandler', () => {
  it('does not publish record update events after type conversion', async () => {
    const { table, tableId, fieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const eventBus = new FakeEventBus();

    const handler = new UpdateFieldHandler(
      tableRepository,
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
});
