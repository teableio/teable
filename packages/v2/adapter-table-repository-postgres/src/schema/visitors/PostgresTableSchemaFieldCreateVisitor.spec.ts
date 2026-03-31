import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createTestDb } from './__tests__/helpers/createTestDb';

const mocks = vi.hoisted(() => ({
  createFieldSchemaRules: vi.fn(),
  createSchemaRuleContext: vi.fn(),
  upAll: vi.fn(),
  PostgresSchemaIntrospector: vi.fn(),
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

    mocks.PostgresSchemaIntrospector.mockImplementation(function (
      this: { currentDb: unknown },
      currentDb
    ) {
      this.currentDb = currentDb;
    });
    mocks.createFieldSchemaRules.mockImplementation((field) =>
      ok([`create:${field.id().toString()}`])
    );
    mocks.createSchemaRuleContext.mockImplementation((context) => context);
    mocks.upAll.mockImplementation((rules) => ok([{ compile: vi.fn(), rules }]));

    const { PostgresTableSchemaFieldCreateVisitor } =
      await loadPostgresTableSchemaFieldCreateVisitor();

    const field = createField('visitSingleLineTextField', 99);
    const visitor = PostgresTableSchemaFieldCreateVisitor.forTableCreation({
      builderRef: { builder: {} as never },
      db: db as never,
      schema: null,
      tableName: 'draft_tasks',
      tableId: 'tbl_draft',
    });
    const table = {
      getFields: () => [field],
    };

    const result = visitor.apply(table as never);

    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(mocks.createSchemaRuleContext).toHaveBeenLastCalledWith(
      expect.objectContaining({
        schema: null,
        tableName: 'draft_tasks',
        tableId: 'tbl_draft',
        field,
      })
    );
  });
});
