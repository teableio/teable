import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createTestDb } from './__tests__/helpers/createTestDb';

const mocks = vi.hoisted(() => ({
  createFieldSchemaRules: vi.fn(),
  createSchemaRuleContext: vi.fn(),
  upAll: vi.fn(),
  PostgresSchemaIntrospector: vi.fn(),
  GeneratedColumnRule: class MockGeneratedColumnRule {
    readonly id: string;

    constructor(
      private readonly field: { id: () => { toString: () => string } },
      private readonly columnType = 'text generated always as ("__created_by") stored'
    ) {
      this.id = `generated_column:${field.id().toString()}`;
    }

    createTableColumnType() {
      return this.columnType;
    }
  },
  FkColumnRule: class MockFkColumnRule {
    readonly id: string;

    constructor(
      private readonly field: { id: () => { toString: () => string } },
      private readonly columnName: string,
      private readonly targetTable?: { schema: string | null; tableName: string }
    ) {
      this.id = `fk_column:${field.id().toString()}`;
    }

    createTableColumnForTarget(targetTable: { schema: string | null; tableName: string }) {
      const target = this.targetTable ?? targetTable;
      if ((target.schema ?? null) !== (targetTable.schema ?? null)) return undefined;
      if (target.tableName !== targetTable.tableName) return undefined;
      return { columnName: this.columnName, dataType: 'text' };
    }
  },
  OrderColumnRule: class MockOrderColumnRule {
    readonly id: string;

    constructor(
      private readonly field: { id: () => { toString: () => string } },
      private readonly columnName: string,
      private readonly targetTable: { schema: string | null; tableName: string }
    ) {
      this.id = `order_column:${field.id().toString()}`;
    }

    createTableColumnForTarget(targetTable: { schema: string | null; tableName: string }) {
      if ((this.targetTable.schema ?? null) !== (targetTable.schema ?? null)) return undefined;
      if (this.targetTable.tableName !== targetTable.tableName) return undefined;
      return { columnName: this.columnName, dataType: 'double precision' };
    }
  },
}));

const methodNames = [
  'visitSingleLineTextField',
  'visitLongTextField',
  'visitNumberField',
  'visitRatingField',
  'visitFormulaField',
  'visitRollupField',
  'visitSingleSelectField',
  'visitMultipleSelectField',
  'visitCheckboxField',
  'visitAttachmentField',
  'visitDateField',
  'visitCreatedTimeField',
  'visitLastModifiedTimeField',
  'visitUserField',
  'visitCreatedByField',
  'visitLastModifiedByField',
  'visitAutoNumberField',
  'visitButtonField',
  'visitLinkField',
  'visitLookupField',
  'visitConditionalRollupField',
  'visitConditionalLookupField',
] as const;

const asId = (value: string) => ({
  toString: () => value,
});

const createField = (methodName: (typeof methodNames)[number], index: number) => {
  const field: Record<string, unknown> = {
    id: () => asId(`fld${String(index).padStart(16, '0')}`),
    name: () => asId(`Field ${index}`),
    type: () => asId(methodName.replace(/^visit|Field$/g, '')),
  };
  field.accept = (visitor: Record<string, (target: unknown) => unknown>) =>
    visitor[methodName](field);
  return field;
};

const loadPostgresTableSchemaFieldCreateVisitor = async () => {
  vi.resetModules();
  vi.doMock('../rules', () => ({
    createFieldSchemaRules: mocks.createFieldSchemaRules,
    createSchemaRuleContext: mocks.createSchemaRuleContext,
    PostgresSchemaIntrospector: mocks.PostgresSchemaIntrospector,
    GeneratedColumnRule: mocks.GeneratedColumnRule,
    FkColumnRule: mocks.FkColumnRule,
    OrderColumnRule: mocks.OrderColumnRule,
    schemaRuleResolver: {
      upAll: mocks.upAll,
    },
  }));
  return import('./PostgresTableSchemaFieldCreateVisitor');
};

describe('PostgresTableSchemaFieldCreateVisitor', () => {
  it('applies all field visitor entry points through the rules resolver', async () => {
    const db = createTestDb();
    const statement = { compile: vi.fn() };

    mocks.PostgresSchemaIntrospector.mockImplementation(function (
      this: { currentDb: unknown },
      currentDb
    ) {
      this.currentDb = currentDb;
    });
    mocks.createFieldSchemaRules.mockImplementation((field) =>
      ok([`rule:${field.id().toString()}`])
    );
    mocks.createSchemaRuleContext.mockImplementation((context) => context);
    mocks.upAll.mockImplementation((rules, context) =>
      ok([
        {
          ...statement,
          context,
          rules,
        },
      ])
    );

    const { PostgresTableSchemaFieldCreateVisitor } =
      await loadPostgresTableSchemaFieldCreateVisitor();

    const visitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate({
      db: db as never,
      schema: 'public',
      tableName: 'tasks',
      tableId: 'tbl_tasks',
      optimizeForEmptyTables: true,
    });
    const fields = methodNames.map((methodName, index) => createField(methodName, index));

    const result = visitor.apply(fields as never);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(methodNames.length);
    expect(mocks.createFieldSchemaRules).toHaveBeenCalledTimes(methodNames.length);
    expect(mocks.createSchemaRuleContext).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        schema: 'public',
        tableName: 'tasks',
        tableId: 'tbl_tasks',
        introspector: expect.any(Object),
        field: fields[0],
        optimizeForEmptyTables: true,
      })
    );
    expect(mocks.upAll).toHaveBeenCalledWith(
      [`rule:${fields[0]?.id().toString()}`],
      expect.objectContaining({
        schema: 'public',
        tableName: 'tasks',
      })
    );
  });

  it('supports table inputs and table-creation mode metadata', async () => {
    const db = createTestDb();
    const builder = {
      addColumn: vi.fn().mockReturnThis(),
    };

    mocks.PostgresSchemaIntrospector.mockImplementation(function (
      this: { currentDb: unknown },
      currentDb
    ) {
      this.currentDb = currentDb;
    });
    mocks.createFieldSchemaRules.mockImplementation((field) =>
      ok([
        {
          id: `column:${field.id().toString()}`,
        },
        {
          id: `reference:${field.id().toString()}`,
        },
      ])
    );
    mocks.createSchemaRuleContext.mockImplementation((context) => context);
    mocks.upAll.mockImplementation((rules) => ok([{ compile: vi.fn(), rules }]));

    const { PostgresTableSchemaFieldCreateVisitor } =
      await loadPostgresTableSchemaFieldCreateVisitor();

    const field = createField('visitSingleLineTextField', 99);
    field.dbFieldName = () =>
      ok({
        value: () => ok('Name'),
      });
    const visitor = PostgresTableSchemaFieldCreateVisitor.forTableCreation({
      builderRef: { builder: builder as never },
      db: db as never,
      schema: null,
      tableName: 'draft_tasks',
      tableId: 'tbl_draft',
    });
    const table = {
      id: () => asId('tbl_draft'),
      dbTableName: () =>
        ok({
          split: () => ok({ schema: null, tableName: 'draft_tasks' }),
        }),
      getFields: () => [field],
    };

    const result = visitor.apply(table as never);

    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(builder.addColumn).toHaveBeenCalledWith('Name', 'text');
    expect(mocks.upAll).toHaveBeenCalledWith(
      [expect.objectContaining({ id: `reference:${field.id().toString()}` })],
      expect.any(Object)
    );
    expect(mocks.createSchemaRuleContext).toHaveBeenLastCalledWith(
      expect.objectContaining({
        schema: null,
        tableName: 'draft_tasks',
        tableId: 'tbl_draft',
        field,
      })
    );
  });

  it('folds generated and same-table helper columns into CREATE TABLE statements', async () => {
    const db = createTestDb();
    const builder = {
      addColumn: vi.fn().mockReturnThis(),
    };
    const generatedColumnType = 'text generated always as ("__created_by") stored';

    mocks.PostgresSchemaIntrospector.mockImplementation(function (
      this: { currentDb: unknown },
      currentDb
    ) {
      this.currentDb = currentDb;
    });
    mocks.createFieldSchemaRules.mockImplementation((field) => {
      const fieldId = field.id().toString();
      if (fieldId.endsWith('100')) {
        return ok([
          new mocks.GeneratedColumnRule(field, generatedColumnType),
          { id: `reference:${fieldId}` },
        ]);
      }
      return ok([
        { id: `link_value_column:${fieldId}` },
        new mocks.FkColumnRule(field, '__fk_assignee', {
          schema: 'public',
          tableName: 'draft_tasks',
        }),
        new mocks.OrderColumnRule(field, '__fk_assignee_order', {
          schema: 'public',
          tableName: 'draft_tasks',
        }),
        { id: `index:${fieldId}:fk_column` },
        { id: `field_meta:${fieldId}:order_column` },
      ]);
    });
    mocks.createSchemaRuleContext.mockImplementation((context) => context);
    mocks.upAll.mockImplementation((rules) => ok([{ compile: vi.fn(), rules }]));

    const { PostgresTableSchemaFieldCreateVisitor } =
      await loadPostgresTableSchemaFieldCreateVisitor();

    const generatedField = createField('visitCreatedByField', 100);
    generatedField.dbFieldName = () =>
      ok({
        value: () => ok('created_by_display'),
      });
    const linkField = createField('visitLinkField', 101);
    linkField.dbFieldName = () =>
      ok({
        value: () => ok('assignee_display'),
      });

    const visitor = PostgresTableSchemaFieldCreateVisitor.forTableCreation({
      builderRef: { builder: builder as never },
      db: db as never,
      schema: 'public',
      tableName: 'draft_tasks',
      tableId: 'tbl_draft',
    });

    const result = visitor.apply([generatedField, linkField] as never);

    expect(result.isOk()).toBe(true);
    expect(builder.addColumn).toHaveBeenCalledWith('created_by_display', generatedColumnType);
    expect(builder.addColumn).toHaveBeenCalledWith('assignee_display', 'jsonb');
    expect(builder.addColumn).toHaveBeenCalledWith('__fk_assignee', 'text');
    expect(builder.addColumn).toHaveBeenCalledWith('__fk_assignee_order', 'double precision');
    expect(mocks.upAll).toHaveBeenCalledWith(
      [expect.objectContaining({ id: `reference:${generatedField.id().toString()}` })],
      expect.any(Object)
    );
    expect(mocks.upAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: `index:${linkField.id().toString()}:fk_column` }),
        expect.objectContaining({ id: `field_meta:${linkField.id().toString()}:order_column` }),
      ],
      expect.any(Object)
    );
  });

  it('keeps cross-table helper columns as schema statements', async () => {
    const db = createTestDb();
    const builder = {
      addColumn: vi.fn().mockReturnThis(),
    };

    mocks.PostgresSchemaIntrospector.mockImplementation(function (
      this: { currentDb: unknown },
      currentDb
    ) {
      this.currentDb = currentDb;
    });
    mocks.createFieldSchemaRules.mockImplementation((field) => {
      const fieldId = field.id().toString();
      return ok([
        new mocks.FkColumnRule(field, '__fk_foreign', {
          schema: 'public',
          tableName: 'foreign_tasks',
        }),
        new mocks.OrderColumnRule(field, '__fk_foreign_order', {
          schema: 'public',
          tableName: 'foreign_tasks',
        }),
      ]);
    });
    mocks.createSchemaRuleContext.mockImplementation((context) => context);
    mocks.upAll.mockImplementation((rules) => ok([{ compile: vi.fn(), rules }]));

    const { PostgresTableSchemaFieldCreateVisitor } =
      await loadPostgresTableSchemaFieldCreateVisitor();

    const linkField = createField('visitLinkField', 102);
    linkField.dbFieldName = () =>
      ok({
        value: () => ok('foreign_display'),
      });

    const visitor = PostgresTableSchemaFieldCreateVisitor.forTableCreation({
      builderRef: { builder: builder as never },
      db: db as never,
      schema: 'public',
      tableName: 'draft_tasks',
      tableId: 'tbl_draft',
    });

    const result = visitor.apply([linkField] as never);

    expect(result.isOk()).toBe(true);
    expect(builder.addColumn).not.toHaveBeenCalledWith('__fk_foreign', 'text');
    expect(builder.addColumn).not.toHaveBeenCalledWith('__fk_foreign_order', 'double precision');
    expect(mocks.upAll).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: `fk_column:${linkField.id().toString()}` }),
        expect.objectContaining({ id: `order_column:${linkField.id().toString()}` }),
      ],
      expect.any(Object)
    );
  });

  it('deduplicates shared same-table helper columns during table creation', async () => {
    const db = createTestDb();
    const builder = {
      addColumn: vi.fn().mockReturnThis(),
    };

    mocks.PostgresSchemaIntrospector.mockImplementation(function (
      this: { currentDb: unknown },
      currentDb
    ) {
      this.currentDb = currentDb;
    });
    mocks.createFieldSchemaRules.mockImplementation((field) => {
      const fieldId = field.id().toString();
      return ok([
        new mocks.FkColumnRule(field, '__fk_shared', {
          schema: 'public',
          tableName: 'draft_tasks',
        }),
        new mocks.OrderColumnRule(field, '__fk_shared_order', {
          schema: 'public',
          tableName: 'draft_tasks',
        }),
        { id: `index:${fieldId}:fk_column` },
      ]);
    });
    mocks.createSchemaRuleContext.mockImplementation((context) => context);
    mocks.upAll.mockImplementation((rules) => ok([{ compile: vi.fn(), rules }]));

    const { PostgresTableSchemaFieldCreateVisitor } =
      await loadPostgresTableSchemaFieldCreateVisitor();

    const firstLinkField = createField('visitLinkField', 103);
    const secondLinkField = createField('visitLinkField', 104);
    const visitor = PostgresTableSchemaFieldCreateVisitor.forTableCreation({
      builderRef: { builder: builder as never },
      db: db as never,
      schema: 'public',
      tableName: 'draft_tasks',
      tableId: 'tbl_draft',
    });

    const result = visitor.apply([firstLinkField, secondLinkField] as never);

    expect(result.isOk()).toBe(true);
    expect(
      builder.addColumn.mock.calls.filter(
        ([columnName, dataType]) => columnName === '__fk_shared' && dataType === 'text'
      )
    ).toHaveLength(1);
    expect(
      builder.addColumn.mock.calls.filter(
        ([columnName, dataType]) =>
          columnName === '__fk_shared_order' && dataType === 'double precision'
      )
    ).toHaveLength(1);
    expect(mocks.upAll).toHaveBeenCalledWith(
      [expect.objectContaining({ id: `index:${firstLinkField.id().toString()}:fk_column` })],
      expect.any(Object)
    );
    expect(mocks.upAll).toHaveBeenCalledWith(
      [expect.objectContaining({ id: `index:${secondLinkField.id().toString()}:fk_column` })],
      expect.any(Object)
    );
  });
});
