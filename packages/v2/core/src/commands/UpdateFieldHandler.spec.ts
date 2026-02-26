import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { FieldUpdateSideEffectService } from '../application/services/FieldUpdateSideEffectService';
import type { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { RecordsBatchUpdated } from '../domain/table/events/RecordsBatchUpdated';
import { FieldUpdated } from '../domain/table/events/FieldUpdated';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { RecordId } from '../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  ITableRecordQueryOptions,
  ITableRecordQueryRepository,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type { ITableRepository, TableUpdatePersistResult } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { UpdateFieldCommand } from './UpdateFieldCommand';
import { UpdateFieldHandler } from './UpdateFieldHandler';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

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

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  rowsByCall: TableRecordReadModel[][] = [];
  private callIndex = 0;

  async find(
    _context?: IExecutionContext,
    _table?: Table,
    _condition?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _query?: {
      mode?: 'stored' | 'computed';
      includeTotal?: boolean;
      projectionFieldIds?: ReadonlyArray<FieldId>;
    }
  ): Promise<Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>> {
    const rows =
      this.rowsByCall[this.callIndex] ?? this.rowsByCall[this.rowsByCall.length - 1] ?? [];
    this.callIndex += 1;
    return ok({ records: rows, total: rows.length });
  }

  async findOne(
    _context: IExecutionContext,
    _table: Table,
    _recordId: RecordId,
    _query?: Pick<ITableRecordQueryOptions, 'mode'>
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    return err(domainError.notFound({ message: 'Record not found' }));
  }

  async *findStream(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    const rows =
      this.rowsByCall[this.callIndex] ?? this.rowsByCall[this.rowsByCall.length - 1] ?? [];
    this.callIndex += 1;
    for (const row of rows) {
      yield ok(row);
    }
  }
}

class MissingColumnOnceRecordQueryRepository extends FakeTableRecordQueryRepository {
  constructor(
    private readonly targetFieldId: FieldId,
    private readonly missingDbFieldName: string
  ) {
    super();
  }

  async find(
    _context: IExecutionContext,
    table: Table,
    _condition?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _query?: ITableRecordQueryOptions
  ): Promise<Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>> {
    const fieldResult = table.getField((f) => f.id().equals(this.targetFieldId));
    if (fieldResult.isErr()) {
      return err(fieldResult.error);
    }

    const dbFieldNameResult = fieldResult.value.dbFieldName().andThen((name) => name.value());
    if (dbFieldNameResult.isOk() && dbFieldNameResult.value === this.missingDbFieldName) {
      return err(
        domainError.unexpected({
          code: 'db.undefined_column',
          message: `Failed to load table records: error: column t.${this.missingDbFieldName} does not exist`,
          details: {
            pgCode: '42703',
            column: this.missingDbFieldName,
          },
        })
      );
    }

    return super.find(_context, table, _condition, _query);
  }
}

describe('UpdateFieldHandler', () => {
  it('publishes RecordsBatchUpdated after type conversion', async () => {
    const { table, tableId, fieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const eventBus = new FakeEventBus();
    const tableRecordQueryRepository = new FakeTableRecordQueryRepository();
    tableRecordQueryRepository.rowsByCall = [
      [
        {
          id: `rec${'a'.repeat(16)}`,
          version: 3,
          fields: {
            [fieldId.toString()]: '100',
          },
        },
        {
          id: `rec${'b'.repeat(16)}`,
          version: 7,
          fields: {
            [fieldId.toString()]: '',
          },
        },
      ],
      [
        {
          id: `rec${'a'.repeat(16)}`,
          version: 4,
          fields: {
            [fieldId.toString()]: 100,
          },
        },
        {
          id: `rec${'b'.repeat(16)}`,
          version: 8,
          fields: {
            [fieldId.toString()]: null,
          },
        },
      ],
    ];

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
      tableRecordQueryRepository,
      eventBus
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

    const batchEvents = eventBus.published.filter(
      (event): event is RecordsBatchUpdated => event instanceof RecordsBatchUpdated
    );
    expect(batchEvents.length).toBe(1);
    expect(batchEvents[0]?.source).toBe('user');
    expect(batchEvents[0]?.updates).toHaveLength(2);
    expect(batchEvents[0]?.updates[0]?.changes[0]?.fieldId).toBe(fieldId.toString());
    expect(batchEvents[0]?.updates[0]?.oldVersion).toBe(3);
    expect(batchEvents[0]?.updates[0]?.changes[0]?.oldValue).toBe('100');
    expect(batchEvents[0]?.updates[0]?.changes[0]?.newValue).toBe(100);
    expect(batchEvents[0]?.updates[1]?.oldVersion).toBe(7);
    expect(batchEvents[0]?.updates[1]?.changes[0]?.oldValue).toBe('');
    expect(batchEvents[0]?.updates[1]?.changes[0]?.newValue).toBeNull();
  });

  it('falls back to field id when stale dbFieldName causes missing column on snapshot read', async () => {
    const { table, tableId, fieldId } = buildTable();

    const fieldResult = table.getField((f) => f.id().equals(fieldId));
    expect(fieldResult.isOk()).toBe(true);
    if (fieldResult.isErr()) {
      return;
    }
    fieldResult.value
      .setDbFieldName(DbFieldName.rehydrate('textDbFieldName')._unsafeUnwrap())
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const eventBus = new FakeEventBus();
    const tableRecordQueryRepository = new MissingColumnOnceRecordQueryRepository(
      fieldId,
      'textDbFieldName'
    );
    tableRecordQueryRepository.rowsByCall = [
      [
        {
          id: `rec${'c'.repeat(16)}`,
          version: 2,
          fields: {
            [fieldId.toString()]: '42',
          },
        },
      ],
      [
        {
          id: `rec${'c'.repeat(16)}`,
          version: 3,
          fields: {
            [fieldId.toString()]: 42,
          },
        },
      ],
    ];

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
      tableRecordQueryRepository,
      eventBus
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
      new FakeTableRecordQueryRepository(),
      eventBus
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
