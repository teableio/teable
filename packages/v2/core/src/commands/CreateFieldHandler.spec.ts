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
import type { FormulaField } from '../domain/table/fields/types/FormulaField';
import type { LinkField } from '../domain/table/fields/types/LinkField';
import type { LookupField } from '../domain/table/fields/types/LookupField';
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
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { CreateFieldCommand } from './CreateFieldCommand';
import { CreateFieldHandler } from './CreateFieldHandler';
import {
  createFieldOperationPluginRunner,
  createTrackedFieldOperationPlugin,
  expectFieldOperationPluginToBeSkipped,
} from './fieldOperationPluginRunnerTestUtils';

const createContext = (options?: {
  maxFieldsPerTable?: number;
  t?: NonNullable<IExecutionContext['$t']>;
}): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  actorIdResult._unsafeUnwrap();
  actorIdResult._unsafeUnwrap();
  return {
    actorId: actorIdResult._unsafeUnwrap(),
    config:
      options?.maxFieldsPerTable == null
        ? undefined
        : {
            tableFields: {
              maxFieldsPerTable: options.maxFieldsPerTable,
            },
          },
    $t: options?.t,
  };
};

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

class InMemoryTableRepository implements ITableRepository {
  tables: Table[] = [];

  async insert(_context: IExecutionContext, table: Table) {
    this.tables.push(table);
    return ok(table);
  }

  async insertMany(_context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.tables.push(...tables);
    return ok([...tables]);
  }

  async findOne(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const match = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!match) return err(domainError.notFound({ message: 'Not found' }));
    return ok(match);
  }

  async find(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const index = this.tables.findIndex((entry) => entry.id().equals(table.id()));
    if (index === -1) return err(domainError.notFound({ message: 'Not found' }));
    this.tables[index] = table;
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  async insert(_context: IExecutionContext, _table: Table) {
    return ok(undefined);
  }

  async insertMany(_context: IExecutionContext, _tables: ReadonlyArray<Table>) {
    return ok(undefined);
  }

  async update(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ) {
    return ok(table);
  }

  async delete(_context: IExecutionContext, _table: Table) {
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  async publish(_context: IExecutionContext, _event: IDomainEvent) {
    return ok(undefined);
  }

  async publishMany(_context: IExecutionContext, _events: ReadonlyArray<IDomainEvent>) {
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

const buildTable = (params: {
  baseId: string;
  tableId: string;
  tableName: string;
  primaryFieldId: string;
}) => {
  return Table.builder()
    .withId(TableId.create(params.tableId)._unsafeUnwrap())
    .withBaseId(BaseId.create(params.baseId)._unsafeUnwrap())
    .withName(TableName.create(params.tableName)._unsafeUnwrap())
    .field()
    .singleLineText()
    .withId(FieldId.create(params.primaryFieldId)._unsafeUnwrap())
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done()
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();
};

let generatedFieldCounter = 0;

const createGeneratedField = (name: string) =>
  SingleLineTextField.create({
    id: FieldId.create(
      `fld${(generatedFieldCounter++).toString(36).padStart(16, '0')}`
    )._unsafeUnwrap(),
    name: FieldName.create(name)._unsafeUnwrap(),
  })._unsafeUnwrap();

const addTextFields = (table: Table, count: number, prefix: string): Table => {
  let currentTable = table;
  for (let index = 0; index < count; index += 1) {
    currentTable = currentTable
      .update((mutator) => mutator.addField(createGeneratedField(`${prefix} ${index + 1}`)))
      ._unsafeUnwrap().table;
  }
  return currentTable;
};

describe('CreateFieldHandler', () => {
  it('supports all link relationships and self references', async () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const hostTableId = `tbl${'b'.repeat(16)}`;
    const foreignTableId = `tbl${'c'.repeat(16)}`;
    const hostPrimaryId = `fld${'d'.repeat(16)}`;
    const foreignPrimaryId = `fld${'e'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const handler = new CreateFieldHandler(
      tableRepository,
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      createFieldOperationPluginRunner([new TableFieldLimitFieldOperationPlugin()]),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    tableRepository.tables.push(
      buildTable({
        baseId,
        tableId: hostTableId,
        tableName: 'Host',
        primaryFieldId: hostPrimaryId,
      }),
      buildTable({
        baseId,
        tableId: foreignTableId,
        tableName: 'Foreign',
        primaryFieldId: foreignPrimaryId,
      })
    );

    const relationships = ['oneOne', 'manyMany', 'oneMany', 'manyOne'] as const;
    for (const relationship of relationships) {
      const commandResult = CreateFieldCommand.create({
        baseId,
        tableId: hostTableId,
        field: {
          type: 'link',
          name: `Link ${relationship}`,
          options: {
            relationship,
            foreignTableId,
            lookupFieldId: foreignPrimaryId,
          },
        },
      });
      commandResult._unsafeUnwrap();

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      result._unsafeUnwrap();

      const updatedForeign = tableRepository.tables.find(
        (table) => table.id().toString() === foreignTableId
      );
      expect(updatedForeign).toBeDefined();
      if (!updatedForeign) continue;
      const linkFields = updatedForeign
        .getFields()
        .filter((field) => field.type().toString() === 'link') as LinkField[];
      expect(linkFields.length).toBeGreaterThan(0);
    }

    const selfCommand = CreateFieldCommand.create({
      baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        name: 'Self',
        options: {
          relationship: 'manyMany',
          foreignTableId: hostTableId,
          lookupFieldId: hostPrimaryId,
        },
      },
    });

    const selfResult = await handler.handle(createContext(), selfCommand._unsafeUnwrap());
    selfResult._unsafeUnwrap();

    const selfTable = tableRepository.tables.find((table) => table.id().toString() === hostTableId);
    expect(selfTable).toBeDefined();
    if (!selfTable) return;
    const selfLinks = selfTable.getFields().filter((field) => field.type().toString() === 'link');
    expect(selfLinks.length).toBeGreaterThan(1);
  });

  it('returns a validation error when the host table exceeds the configured field limit', async () => {
    const baseId = `bse${'k'.repeat(16)}`;
    const tableId = `tbl${'l'.repeat(16)}`;
    const primaryFieldId = `fld${'m'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const handler = new CreateFieldHandler(
      tableRepository,
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      createFieldOperationPluginRunner([new TableFieldLimitFieldOperationPlugin()]),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    tableRepository.tables.push(
      buildTable({
        baseId,
        tableId,
        tableName: 'Host',
        primaryFieldId,
      })
    );

    const command = CreateFieldCommand.create({
      baseId,
      tableId,
      field: {
        type: 'singleLineText',
        name: 'Overflow',
      },
    })._unsafeUnwrap();
    const result = await handler.handle(
      createContext({
        maxFieldsPerTable: 1,
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
    expect(result.error.message).toContain('limit:1');
    expect(result.error.details).toMatchObject({
      tableName: 'Host',
      currentFieldCount: 1,
      attemptedFieldCount: 2,
      maxFieldCount: 1,
    });
    expect(tableRepository.tables[0]?.getFields()).toHaveLength(1);
  });

  it('rejects two-way link creation when the reciprocal table would exceed the configured field limit', async () => {
    const baseId = `bse${'n'.repeat(16)}`;
    const hostTableId = `tbl${'o'.repeat(16)}`;
    const foreignTableId = `tbl${'p'.repeat(16)}`;
    const hostPrimaryId = `fld${'q'.repeat(16)}`;
    const foreignPrimaryId = `fld${'r'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const handler = new CreateFieldHandler(
      tableRepository,
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      createFieldOperationPluginRunner([new TableFieldLimitFieldOperationPlugin()]),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    const hostTable = buildTable({
      baseId,
      tableId: hostTableId,
      tableName: 'Host',
      primaryFieldId: hostPrimaryId,
    });
    const foreignTable = addTextFields(
      buildTable({
        baseId,
        tableId: foreignTableId,
        tableName: 'Foreign',
        primaryFieldId: foreignPrimaryId,
      }),
      2,
      'Foreign Extra'
    );

    tableRepository.tables.push(hostTable, foreignTable);

    const command = CreateFieldCommand.create({
      baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        name: 'Host Link',
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
    expect(
      tableRepository.tables.find((table) => table.id().toString() === hostTableId)?.getFields()
    ).toHaveLength(1);
    expect(
      tableRepository.tables.find((table) => table.id().toString() === foreignTableId)?.getFields()
    ).toHaveLength(3);
  });

  it('runs create plugins for reciprocal side-effect target tables', async () => {
    const baseId = `bse${'s'.repeat(16)}`;
    const hostTableId = `tbl${'t'.repeat(16)}`;
    const foreignTableId = `tbl${'u'.repeat(16)}`;
    const hostPrimaryId = `fld${'v'.repeat(16)}`;
    const foreignPrimaryId = `fld${'w'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const { plugin, calls } = createTrackedFieldOperationPlugin([FieldOperationKind.create]);
    const handler = new CreateFieldHandler(
      tableRepository,
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      createFieldOperationPluginRunner([plugin]),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    tableRepository.tables.push(
      buildTable({
        baseId,
        tableId: hostTableId,
        tableName: 'Host',
        primaryFieldId: hostPrimaryId,
      }),
      buildTable({
        baseId,
        tableId: foreignTableId,
        tableName: 'Foreign',
        primaryFieldId: foreignPrimaryId,
      })
    );

    const command = CreateFieldCommand.create({
      baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        name: 'Host Link',
        options: {
          relationship: 'manyMany',
          foreignTableId,
          lookupFieldId: foreignPrimaryId,
        },
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(calls.prepare).toHaveLength(2);
    expect(calls.guard).toHaveLength(2);
    expect(calls.beforePersist).toHaveLength(2);
    expect(calls.afterCommit).toHaveLength(2);

    const directContext = calls.prepare.find((context) => context.target.kind === 'direct');
    const sideEffectContext = calls.prepare.find((context) => context.target.kind === 'sideEffect');

    expect(directContext?.kind).toBe(FieldOperationKind.create);
    expect(directContext?.table.id().toString()).toBe(hostTableId);
    expect(sideEffectContext?.kind).toBe(FieldOperationKind.create);
    expect(sideEffectContext?.table.id().toString()).toBe(foreignTableId);
    expect(sideEffectContext?.target.sourceOperation).toBe(FieldOperationKind.create);
    expect(sideEffectContext?.target.sourceTable.id().toString()).toBe(hostTableId);
  });

  it('creates formula field with resolved cellValueType', async () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const tableId = `tbl${'b'.repeat(16)}`;
    const numberFieldId = `fld${'c'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const handler = new CreateFieldHandler(
      tableRepository,
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    // Create a table with a number field
    const table = Table.builder()
      .withId(TableId.create(tableId)._unsafeUnwrap())
      .withBaseId(BaseId.create(baseId)._unsafeUnwrap())
      .withName(TableName.create('TestTable')._unsafeUnwrap())
      .field()
      .number()
      .withId(FieldId.create(numberFieldId)._unsafeUnwrap())
      .withName(FieldName.create('Amount')._unsafeUnwrap())
      .primary()
      .done()
      .view()
      .defaultGrid()
      .done()
      .build()
      ._unsafeUnwrap();
    tableRepository.tables.push(table);

    // Create a formula field referencing the number field
    const commandResult = CreateFieldCommand.create({
      baseId,
      tableId,
      field: {
        type: 'formula',
        name: 'Total',
        options: { expression: `{${numberFieldId}}` },
      },
    });
    commandResult._unsafeUnwrap();

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    const updatedTable = tableRepository.tables.find((t) => t.id().toString() === tableId);
    expect(updatedTable).toBeDefined();
    if (!updatedTable) return;

    const formulaField = updatedTable
      .getFields()
      .find((field) => field.type().toString() === 'formula') as FormulaField | undefined;
    expect(formulaField).toBeDefined();
    if (!formulaField) return;

    // Verify cellValueType is set
    const cellValueTypeResult = formulaField.cellValueType();
    expect(cellValueTypeResult.isOk()).toBe(true);
    cellValueTypeResult._unsafeUnwrap();
  });

  it('derives lookup multiplicity from oneMany link in domain layer', async () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const hostTableId = `tbl${'b'.repeat(16)}`;
    const foreignTableId = `tbl${'c'.repeat(16)}`;
    const hostPrimaryId = `fld${'d'.repeat(16)}`;
    const foreignPrimaryId = `fld${'e'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const handler = new CreateFieldHandler(
      tableRepository,
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    tableRepository.tables.push(
      buildTable({
        baseId,
        tableId: hostTableId,
        tableName: 'Host',
        primaryFieldId: hostPrimaryId,
      }),
      buildTable({
        baseId,
        tableId: foreignTableId,
        tableName: 'Foreign',
        primaryFieldId: foreignPrimaryId,
      })
    );

    const createLink = CreateFieldCommand.create({
      baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        name: 'Host Link',
        options: {
          relationship: 'oneMany',
          foreignTableId,
          lookupFieldId: foreignPrimaryId,
        },
      },
    })._unsafeUnwrap();
    const linkResult = await handler.handle(createContext(), createLink);
    linkResult._unsafeUnwrap();

    const hostAfterLink = tableRepository.tables.find(
      (table) => table.id().toString() === hostTableId
    );
    expect(hostAfterLink).toBeDefined();
    if (!hostAfterLink) return;

    const linkField = hostAfterLink
      .getFields()
      .find((field) => field.name().toString() === 'Host Link') as LinkField | undefined;
    expect(linkField).toBeDefined();
    if (!linkField) return;

    const createLookup = CreateFieldCommand.create({
      baseId,
      tableId: hostTableId,
      field: {
        type: 'lookup',
        name: 'Lookup Name',
        options: {
          foreignTableId,
          linkFieldId: linkField.id().toString(),
          lookupFieldId: foreignPrimaryId,
        },
      },
    })._unsafeUnwrap();
    const lookupResult = await handler.handle(createContext(), createLookup);
    lookupResult._unsafeUnwrap();

    const hostAfterLookup = tableRepository.tables.find(
      (table) => table.id().toString() === hostTableId
    );
    expect(hostAfterLookup).toBeDefined();
    if (!hostAfterLookup) return;

    const lookupField = hostAfterLookup
      .getFields()
      .find((field) => field.name().toString() === 'Lookup Name') as LookupField | undefined;
    expect(lookupField?.type().toString()).toBe('lookup');
    expect(lookupField?.isMultipleCellValue()._unsafeUnwrap().isMultiple()).toBe(true);
  });

  it('derives lookup multiplicity as single for manyOne link in legacy mode', async () => {
    const baseId = `bse${'f'.repeat(16)}`;
    const hostTableId = `tbl${'g'.repeat(16)}`;
    const foreignTableId = `tbl${'h'.repeat(16)}`;
    const hostPrimaryId = `fld${'i'.repeat(16)}`;
    const foreignPrimaryId = `fld${'j'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const handler = new CreateFieldHandler(
      tableRepository,
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    tableRepository.tables.push(
      buildTable({
        baseId,
        tableId: hostTableId,
        tableName: 'Host',
        primaryFieldId: hostPrimaryId,
      }),
      buildTable({
        baseId,
        tableId: foreignTableId,
        tableName: 'Foreign',
        primaryFieldId: foreignPrimaryId,
      })
    );

    const createLink = CreateFieldCommand.create({
      baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        name: 'Host Link',
        options: {
          relationship: 'manyOne',
          foreignTableId,
          lookupFieldId: foreignPrimaryId,
        },
      },
    })._unsafeUnwrap();
    const linkResult = await handler.handle(createContext(), createLink);
    linkResult._unsafeUnwrap();

    const hostAfterLink = tableRepository.tables.find(
      (table) => table.id().toString() === hostTableId
    );
    expect(hostAfterLink).toBeDefined();
    if (!hostAfterLink) return;

    const linkField = hostAfterLink
      .getFields()
      .find((field) => field.name().toString() === 'Host Link') as LinkField | undefined;
    expect(linkField).toBeDefined();
    if (!linkField) return;

    const createLookup = CreateFieldCommand.create({
      baseId,
      tableId: hostTableId,
      field: {
        type: 'lookup',
        name: 'Lookup Name',
        legacyMultiplicityDerivation: true,
        options: {
          foreignTableId,
          linkFieldId: linkField.id().toString(),
          lookupFieldId: foreignPrimaryId,
        },
      },
    })._unsafeUnwrap();
    const lookupResult = await handler.handle(createContext(), createLookup);
    lookupResult._unsafeUnwrap();

    const hostAfterLookup = tableRepository.tables.find(
      (table) => table.id().toString() === hostTableId
    );
    expect(hostAfterLookup).toBeDefined();
    if (!hostAfterLookup) return;

    const lookupField = hostAfterLookup
      .getFields()
      .find((field) => field.name().toString() === 'Lookup Name') as LookupField | undefined;
    expect(lookupField?.type().toString()).toBe('lookup');
    expect(lookupField?.isMultipleCellValue()._unsafeUnwrap().isMultiple()).toBe(false);
  });

  it('allows cross-base conditional lookup creation', async () => {
    const hostBaseId = `bse${'a'.repeat(16)}`;
    const foreignBaseId = `bse${'b'.repeat(16)}`;
    const hostTableId = `tbl${'c'.repeat(16)}`;
    const foreignTableId = `tbl${'d'.repeat(16)}`;
    const hostPrimaryId = `fld${'e'.repeat(16)}`;
    const foreignPrimaryId = `fld${'f'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const handler = new CreateFieldHandler(
      tableRepository,
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      createFieldOperationPluginRunner(),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    tableRepository.tables.push(
      buildTable({
        baseId: hostBaseId,
        tableId: hostTableId,
        tableName: 'Host',
        primaryFieldId: hostPrimaryId,
      }),
      buildTable({
        baseId: foreignBaseId,
        tableId: foreignTableId,
        tableName: 'Foreign',
        primaryFieldId: foreignPrimaryId,
      })
    );

    const commandResult = CreateFieldCommand.create({
      baseId: hostBaseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        name: 'Cross Base Amounts',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: foreignPrimaryId, operator: 'is', value: 'A' }],
            },
          },
        },
      },
    });
    commandResult._unsafeUnwrap();

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    const updatedTable = tableRepository.tables.find(
      (table) => table.id().toString() === hostTableId
    );
    expect(updatedTable).toBeDefined();
    if (!updatedTable) return;

    const conditionalLookup = updatedTable
      .getFields()
      .find((field) => field.name().toString() === 'Cross Base Amounts');
    expect(conditionalLookup?.type().toString()).toBe('conditionalLookup');
  });

  it('skips plugins that do not support create', async () => {
    const baseId = `bse${'g'.repeat(16)}`;
    const tableId = `tbl${'h'.repeat(16)}`;
    const primaryFieldId = `fld${'i'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const { plugin, calls } = createTrackedFieldOperationPlugin([FieldOperationKind.update]);
    const handler = new CreateFieldHandler(
      tableRepository,
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      createFieldOperationPluginRunner([plugin]),
      noopUndoRedoService,
      noopFieldUndoRedoSnapshotService
    );

    tableRepository.tables.push(
      buildTable({
        baseId,
        tableId,
        tableName: 'Plugin Host',
        primaryFieldId,
      })
    );

    const command = CreateFieldCommand.create({
      baseId,
      tableId,
      field: {
        type: 'number',
        name: 'Amount',
      },
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expectFieldOperationPluginToBeSkipped(calls, FieldOperationKind.create);
  });
});
