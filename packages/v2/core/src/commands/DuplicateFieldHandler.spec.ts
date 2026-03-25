import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import type { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableFieldLimitFieldOperationPlugin } from '../application/services/TableFieldLimitFieldOperationPlugin';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoService } from '../application/services/UndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TABLE_FIELD_LIMIT_ERROR_CODE } from '../domain/table/TableFieldLimit';
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
import { DuplicateFieldCommand } from './DuplicateFieldCommand';
import { DuplicateFieldHandler } from './DuplicateFieldHandler';
import {
  createFieldOperationPluginRunner,
  createTrackedFieldOperationPlugin,
  expectFieldOperationPluginToBeSkipped,
} from './fieldOperationPluginRunnerTestUtils';

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
    });
  },
} as unknown as FieldUndoRedoSnapshotService;

const buildTable = () => {
  const baseId = BaseId.create(`bse${'m'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'n'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Duplicate Field Table')._unsafeUnwrap();
  const primaryFieldId = FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap();
  const sourceFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();

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
    .withId(sourceFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    baseId,
    tableId,
    sourceFieldId,
  };
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
    if (!match) {
      return err(domainError.notFound({ message: 'Table not found' }));
    }
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
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const index = this.tables.findIndex((entry) => entry.id().equals(table.id()));
    if (index >= 0) {
      this.tables[index] = table;
    }
    return ok(undefined);
  }

  async restore(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
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
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  async publish(_: IExecutionContext, __: IDomainEvent): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async publishMany(
    _: IExecutionContext,
    __: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
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

describe('DuplicateFieldHandler', () => {
  it('returns a validation error when duplication exceeds the configured field limit', async () => {
    const { table, baseId, tableId, sourceFieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);

    const handler = new DuplicateFieldHandler(
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      tableRepository,
      createFieldOperationPluginRunner([new TableFieldLimitFieldOperationPlugin()]),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    const command = DuplicateFieldCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      fieldId: sourceFieldId.toString(),
      includeRecordValues: false,
    })._unsafeUnwrap();

    const result = await handler.handle(
      createContext({
        maxFieldsPerTable: 2,
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
    expect(result.error.message).toContain('limit:2');
    expect(result.error.details).toMatchObject({
      tableName: 'Duplicate Field Table',
      currentFieldCount: 2,
      attemptedFieldCount: 3,
      maxFieldCount: 2,
    });
  });

  it('skips plugins that do not support duplicate', async () => {
    const { table, baseId, tableId, sourceFieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const { plugin, calls } = createTrackedFieldOperationPlugin([FieldOperationKind.create]);

    const handler = new DuplicateFieldHandler(
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      tableRepository,
      createFieldOperationPluginRunner([plugin]),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    const command = DuplicateFieldCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      fieldId: sourceFieldId.toString(),
      includeRecordValues: false,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expectFieldOperationPluginToBeSkipped(calls, FieldOperationKind.duplicate);
  });
});
