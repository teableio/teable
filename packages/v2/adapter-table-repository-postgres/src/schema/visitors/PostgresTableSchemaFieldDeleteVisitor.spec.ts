import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createTestDb } from './__tests__/helpers/createTestDb';

const mocks = vi.hoisted(() => ({
  createFieldSchemaRules: vi.fn(),
  createSchemaRuleContext: vi.fn(),
  downAll: vi.fn(),
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
  return Object.assign(field, {
    accept: (visitor: Record<string, (target: unknown) => unknown>) => visitor[methodName](field),
  });
};

const loadPostgresTableSchemaFieldDeleteVisitor = async () => {
  vi.resetModules();
  vi.doMock('../rules', () => ({
    createFieldSchemaRules: mocks.createFieldSchemaRules,
    createSchemaRuleContext: mocks.createSchemaRuleContext,
    PostgresSchemaIntrospector: mocks.PostgresSchemaIntrospector,
    schemaRuleResolver: {
      downAll: mocks.downAll,
    },
  }));
  return import('./PostgresTableSchemaFieldDeleteVisitor');
};

describe('PostgresTableSchemaFieldDeleteVisitor', () => {
  it('delegates schema-update deletions through downAll in delete mode', async () => {
    const db = createTestDb();

    mocks.PostgresSchemaIntrospector.mockImplementation(function (
      this: { currentDb: unknown },
      currentDb
    ) {
      this.currentDb = currentDb;
    });
    mocks.createFieldSchemaRules.mockImplementation((field) =>
      ok([`delete:${field.id().toString()}`])
    );
    mocks.createSchemaRuleContext.mockImplementation((context) => context);
    mocks.downAll.mockImplementation((rules, context) =>
      ok([{ compile: vi.fn(), rules, context }])
    );

    const { PostgresTableSchemaFieldDeleteVisitor } =
      await loadPostgresTableSchemaFieldDeleteVisitor();

    const visitor = PostgresTableSchemaFieldDeleteVisitor.forSchemaUpdate({
      db: db as never,
      schema: 'public',
      tableName: 'tasks',
      tableId: 'tbl_tasks',
    });
    const field = createField('visitLinkField', 1);

    const result = visitor.visitLinkField(field as never);

    expect(result.isOk()).toBe(true);
    expect(mocks.createSchemaRuleContext).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        schema: 'public',
        tableName: 'tasks',
        tableId: 'tbl_tasks',
        field,
      })
    );
    expect(mocks.downAll).toHaveBeenCalledWith(
      [`delete:${field.id().toString()}`],
      expect.objectContaining({
        schema: 'public',
        tableName: 'tasks',
        mode: 'delete',
      })
    );
  });

  it('delegates all field types and preserves references in conversion mode', async () => {
    const db = createTestDb();

    mocks.PostgresSchemaIntrospector.mockImplementation(function (
      this: { currentDb: unknown },
      currentDb
    ) {
      this.currentDb = currentDb;
    });
    mocks.createFieldSchemaRules.mockImplementation((field) =>
      ok([`convert:${field.id().toString()}`])
    );
    mocks.createSchemaRuleContext.mockImplementation((context) => context);
    mocks.downAll.mockImplementation((rules, context) =>
      ok([{ compile: vi.fn(), rules, context }])
    );

    const { PostgresTableSchemaFieldDeleteVisitor } =
      await loadPostgresTableSchemaFieldDeleteVisitor();

    const visitor = PostgresTableSchemaFieldDeleteVisitor.forConversion({
      db: db as never,
      schema: null,
      tableName: 'draft_tasks',
      tableId: 'tbl_draft',
    });

    for (const [index, methodName] of methodNames.entries()) {
      const field = createField(methodName, index + 10);
      const result = (visitor[methodName] as (input: unknown) => { _unsafeUnwrap(): unknown[] })(
        field as never
      );

      expect(result._unsafeUnwrap()).toHaveLength(1);
    }

    expect(mocks.createFieldSchemaRules).toHaveBeenCalledTimes(methodNames.length);
    expect(mocks.downAll).toHaveBeenLastCalledWith(
      [expect.stringMatching(/^convert:/)],
      expect.not.objectContaining({ mode: 'delete' })
    );
  });
});
