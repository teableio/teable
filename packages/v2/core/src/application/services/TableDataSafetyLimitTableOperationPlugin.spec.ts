import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { TableSortKey } from '../../domain/table/TableSortKey';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { IFindOptions } from '../../ports/RepositoryQuery';
import {
  TableOperationKind,
  type TableOperationPluginContext,
} from '../../ports/TableOperationPlugin';
import type { ITableRepository } from '../../ports/TableRepository';
import {
  StaticTableDataSafetyLimitPlugin,
  TableDataSafetyLimitComposer,
} from './TableDataSafetyLimitComposer';
import { TableDataSafetyLimitTableOperationPlugin } from './TableDataSafetyLimitTableOperationPlugin';

const actorId = ActorId.create('system')._unsafeUnwrap();
const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();

const createTable = (
  idSeed: string,
  name: string,
  tableBaseId = baseId,
  fieldName = 'Title'
): Table =>
  Table.builder()
    .withId(TableId.create(`tbl${idSeed.repeat(16)}`)._unsafeUnwrap())
    .withBaseId(tableBaseId)
    .withName(TableName.create(name)._unsafeUnwrap())
    .field()
    .singleLineText()
    .withName(FieldName.create(fieldName)._unsafeUnwrap())
    .primary()
    .done()
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];

  async insert(_context: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    this.tables.push(table);
    return ok(table);
  }

  async insertMany(
    _context: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
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

  async updateOne(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async restore(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

const createExecutionContext = (): IExecutionContext => ({ actorId });

const createPlugin = (repository: ITableRepository, maxNameLength = 10) =>
  new TableDataSafetyLimitTableOperationPlugin(
    repository,
    new TableDataSafetyLimitComposer([
      new StaticTableDataSafetyLimitPlugin({
        displayText: { maxNameLength },
        tableSchema: {
          maxTablesPerBase: 3,
          maxCreateTableFields: 2,
          maxCreateTableViews: 2,
          maxCreateTableRecords: 2,
          maxViewsPerTable: 2,
        },
      }),
    ])
  );

const createViewsPerTableOnlyPlugin = (repository: ITableRepository) =>
  new TableDataSafetyLimitTableOperationPlugin(
    repository,
    new TableDataSafetyLimitComposer([
      new StaticTableDataSafetyLimitPlugin({
        displayText: { maxNameLength: 10 },
        tableSchema: {
          maxTablesPerBase: 3,
          maxCreateTableFields: 2,
          maxCreateTableViews: 5,
          maxCreateTableRecords: 2,
          maxViewsPerTable: 2,
        },
      }),
    ])
  );

const createFieldsPerTableOnlyPlugin = (repository: ITableRepository) =>
  new TableDataSafetyLimitTableOperationPlugin(
    repository,
    new TableDataSafetyLimitComposer([
      new StaticTableDataSafetyLimitPlugin({
        displayText: { maxNameLength: 20 },
        tableSchema: {
          maxTablesPerBase: 3,
          maxFieldsPerTable: 2,
          maxCreateTableFields: 5,
          maxCreateTableViews: 2,
          maxCreateTableRecords: 2,
          maxViewsPerTable: 2,
        },
      }),
    ])
  );

const runPlugin = async (
  plugin: TableDataSafetyLimitTableOperationPlugin,
  context: TableOperationPluginContext
) => {
  const preparedResult = await plugin.prepare(context);
  if (preparedResult.isErr()) return preparedResult;
  return plugin.guard(context, preparedResult.value);
};

const createContext = (
  kind: TableOperationKind,
  payload: Record<string, unknown>
): TableOperationPluginContext =>
  ({
    kind,
    executionContext: createExecutionContext(),
    payload,
    isTransactionBound: false,
  }) as unknown as TableOperationPluginContext;

describe('TableDataSafetyLimitTableOperationPlugin', () => {
  it('supports all table operation kinds', () => {
    const plugin = createPlugin(new FakeTableRepository());

    expect(plugin.supports(TableOperationKind.create)).toBe(true);
    expect(plugin.supports(TableOperationKind.createMany)).toBe(true);
    expect(plugin.supports(TableOperationKind.duplicate)).toBe(true);
    expect(plugin.supports(TableOperationKind.importCsv)).toBe(true);
    expect(plugin.supports(TableOperationKind.rename)).toBe(true);
  });

  it.each([
    [
      TableOperationKind.create,
      {
        baseId,
        tableName: TableName.create('Create')._unsafeUnwrap(),
        fieldCount: 2,
        viewCount: 2,
        recordCount: 2,
        viewNames: ['View A', 'View B'],
      },
    ],
    [
      TableOperationKind.createMany,
      {
        baseId,
        tables: [
          {
            baseId,
            tableName: TableName.create('Table A')._unsafeUnwrap(),
            fieldCount: 2,
            viewCount: 2,
            recordCount: 2,
            viewNames: ['View A', 'View B'],
          },
          {
            baseId,
            tableName: TableName.create('Table B')._unsafeUnwrap(),
            fieldCount: 1,
            viewCount: 1,
            recordCount: 1,
            viewNames: ['View A'],
          },
        ],
      },
    ],
    [
      TableOperationKind.duplicate,
      {
        baseId,
        tableName: TableName.create('Copy')._unsafeUnwrap(),
        includeRecords: true,
      },
    ],
    [
      TableOperationKind.importCsv,
      {
        baseId,
        tableName: TableName.create('Import')._unsafeUnwrap(),
        fieldCount: 2,
        viewCount: 1,
        recordCount: 2,
      },
    ],
    [
      TableOperationKind.rename,
      {
        baseId,
        tableName: TableName.create('Rename')._unsafeUnwrap(),
      },
    ],
  ] satisfies ReadonlyArray<readonly [TableOperationKind, Record<string, unknown>]>)(
    'allows %s at configured table operation boundaries',
    async (kind, payload) => {
      const repository = new FakeTableRepository();
      repository.tables.push(createTable('b', 'Existing'));
      const result = await runPlugin(createPlugin(repository), createContext(kind, payload));

      expect(result.isOk()).toBe(true);
    }
  );

  it.each([
    [
      'validation.limit.tables_per_base_max',
      TableOperationKind.create,
      {
        baseId,
        tableName: TableName.create('Create')._unsafeUnwrap(),
        fieldCount: 1,
        viewCount: 1,
        recordCount: 0,
        viewNames: ['View A'],
      },
      [
        createTable('b', 'Existing 1'),
        createTable('c', 'Existing 2'),
        createTable('d', 'Existing 3'),
      ],
    ],
    [
      'validation.limit.create_table_fields_max',
      TableOperationKind.create,
      {
        baseId,
        tableName: TableName.create('Create')._unsafeUnwrap(),
        fieldCount: 3,
        viewCount: 1,
        recordCount: 0,
        viewNames: ['View A'],
      },
      [],
    ],
    [
      'validation.limit.create_table_views_max',
      TableOperationKind.create,
      {
        baseId,
        tableName: TableName.create('Create')._unsafeUnwrap(),
        fieldCount: 1,
        viewCount: 3,
        recordCount: 0,
        viewNames: ['View A', 'View B', 'View C'],
      },
      [],
    ],
    [
      'validation.limit.create_table_records_max',
      TableOperationKind.create,
      {
        baseId,
        tableName: TableName.create('Create')._unsafeUnwrap(),
        fieldCount: 1,
        viewCount: 1,
        recordCount: 3,
        viewNames: ['View A'],
      },
      [],
    ],
    [
      'validation.limit.name_max_length',
      TableOperationKind.create,
      {
        baseId,
        tableName: TableName.create('Too Long Name')._unsafeUnwrap(),
        fieldCount: 1,
        viewCount: 1,
        recordCount: 0,
        viewNames: ['View A'],
      },
      [],
    ],
    [
      'validation.limit.name_max_length',
      TableOperationKind.create,
      {
        baseId,
        tableName: TableName.create('Create')._unsafeUnwrap(),
        fieldCount: 1,
        viewCount: 1,
        recordCount: 0,
        viewNames: ['Too Long View Name'],
      },
      [],
    ],
    [
      'validation.limit.create_table_records_max',
      TableOperationKind.importCsv,
      {
        baseId,
        tableName: TableName.create('Import')._unsafeUnwrap(),
        fieldCount: 1,
        viewCount: 1,
        recordCount: 3,
      },
      [],
    ],
    [
      'validation.limit.name_max_length',
      TableOperationKind.rename,
      {
        baseId,
        tableName: TableName.create('Too Long Name')._unsafeUnwrap(),
      },
      [],
    ],
  ] satisfies ReadonlyArray<
    readonly [string, TableOperationKind, Record<string, unknown>, ReadonlyArray<Table>]
  >)('rejects %s for %s', async (expectedCode, kind, payload, existingTables) => {
    const repository = new FakeTableRepository();
    repository.tables.push(...existingTables);

    const result = await runPlugin(createPlugin(repository), createContext(kind, payload));

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(expectedCode);
  });

  it('rejects create when the view count exceeds the configured views-per-table limit', async () => {
    const repository = new FakeTableRepository();
    const result = await runPlugin(
      createViewsPerTableOnlyPlugin(repository),
      createContext(TableOperationKind.create, {
        baseId,
        tableName: TableName.create('Create')._unsafeUnwrap(),
        fieldCount: 1,
        viewCount: 3,
        recordCount: 0,
        viewNames: [],
      })
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.views_per_table_max');
  });

  it('rejects create when the field count exceeds the configured fields-per-table limit', async () => {
    const repository = new FakeTableRepository();
    const result = await runPlugin(
      createFieldsPerTableOnlyPlugin(repository),
      createContext(TableOperationKind.create, {
        baseId,
        tableName: TableName.create('Create')._unsafeUnwrap(),
        fieldCount: 3,
        viewCount: 1,
        recordCount: 0,
        viewNames: ['View A'],
      })
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.fields_per_table_max');
  });

  it('rejects create when a built field exceeds display text limits', async () => {
    const repository = new FakeTableRepository();
    const result = await runPlugin(
      createPlugin(repository),
      createContext(TableOperationKind.create, {
        baseId,
        tableName: TableName.create('Create')._unsafeUnwrap(),
        table: createTable('e', 'Create', baseId, 'Too Long Field'),
        fieldCount: 1,
        viewCount: 1,
        recordCount: 0,
        viewNames: ['View A'],
      })
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.name_max_length');
    expect(result._unsafeUnwrapErr().details?.target).toBe('field.name');
  });

  it('composes multiple table limit plugins with the strictest numeric limit', async () => {
    const repository = new FakeTableRepository();
    const plugin = new TableDataSafetyLimitTableOperationPlugin(
      repository,
      new TableDataSafetyLimitComposer([
        new StaticTableDataSafetyLimitPlugin({
          tableSchema: { maxCreateTableRecords: 10 },
        }),
        new StaticTableDataSafetyLimitPlugin({
          tableSchema: { maxCreateTableRecords: 2 },
        }),
      ])
    );

    const result = await runPlugin(
      plugin,
      createContext(TableOperationKind.create, {
        baseId,
        tableName: TableName.create('Create')._unsafeUnwrap(),
        fieldCount: 1,
        viewCount: 1,
        recordCount: 3,
        viewNames: ['View A'],
      })
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.create_table_records_max');
  });
});
