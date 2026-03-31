import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createTestDb } from './__tests__/helpers/createTestDb';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  generateStatements: vi.fn(),
}));

const createField = (params: { id: string; type: string }) => ({
  id: () => ({
    toString: () => params.id,
  }),
  type: () => ({
    toString: () => params.type,
    equals: (other: { toString(): string }) => other.toString() === params.type,
  }),
});

const loadFieldValueDuplicateVisitor = async () => {
  vi.resetModules();
  vi.doMock('./LinkFieldValueDuplicateVisitor', () => ({
    LinkFieldValueDuplicateVisitor: {
      create: mocks.create,
    },
  }));
  return import('./FieldValueDuplicateVisitor');
};

describe('FieldValueDuplicateVisitor', () => {
  it('generates simple copy SQL for storable fields and skips computed/system fields', async () => {
    const { FieldValueDuplicateVisitor } = await loadFieldValueDuplicateVisitor();
    const db = createTestDb() as never;
    const visitor = FieldValueDuplicateVisitor.create(db, {
      schema: 'public',
      tableName: 'tasks',
      sourceDbFieldName: 'old_col',
      targetDbFieldName: 'new_col',
    });

    const simpleMethods = [
      'visitSingleLineTextField',
      'visitLongTextField',
      'visitNumberField',
      'visitRatingField',
      'visitCheckboxField',
      'visitDateField',
      'visitSingleSelectField',
      'visitMultipleSelectField',
      'visitUserField',
      'visitAttachmentField',
    ] as const;
    const skipMethods = [
      'visitFormulaField',
      'visitRollupField',
      'visitConditionalRollupField',
      'visitConditionalLookupField',
      'visitAutoNumberField',
      'visitCreatedTimeField',
      'visitLastModifiedTimeField',
      'visitCreatedByField',
      'visitLastModifiedByField',
      'visitButtonField',
    ] as const;

    for (const methodName of simpleMethods) {
      const queries = (
        visitor[methodName] as (field: unknown) => { _unsafeUnwrap(): Array<{ sql: string }> }
      )(createField({ id: `${methodName}_id`, type: 'text' }) as never)._unsafeUnwrap();
      expect(queries).toHaveLength(1);
      expect(queries[0]?.sql).toContain('UPDATE "public"."tasks"');
      expect(queries[0]?.sql).toContain('"new_col" = "old_col"');
    }

    for (const methodName of skipMethods) {
      const queries = (visitor[methodName] as (field: unknown) => { _unsafeUnwrap(): unknown[] })(
        createField({ id: `${methodName}_id`, type: 'formula' }) as never
      )._unsafeUnwrap();
      expect(queries).toEqual([]);
    }
  });

  it('falls back to simple copy for link fields without a new link target', async () => {
    const { FieldValueDuplicateVisitor } = await loadFieldValueDuplicateVisitor();
    const db = createTestDb() as never;
    const sourceLink = createField({ id: 'fld_source', type: 'link' });

    const withoutNewField = FieldValueDuplicateVisitor.create(db, {
      schema: null,
      tableName: 'tasks',
      sourceDbFieldName: 'old_link',
      targetDbFieldName: 'new_link',
    });
    const wrongTypeNewField = FieldValueDuplicateVisitor.create(db, {
      schema: null,
      tableName: 'tasks',
      sourceDbFieldName: 'old_link',
      targetDbFieldName: 'new_link',
      newField: createField({ id: 'fld_other', type: 'number' }) as never,
    });

    const noNewFieldQuery = withoutNewField.visitLinkField(sourceLink as never)._unsafeUnwrap();
    const wrongTypeQuery = wrongTypeNewField.visitLinkField(sourceLink as never)._unsafeUnwrap();

    expect(noNewFieldQuery).toHaveLength(1);
    expect(noNewFieldQuery[0]?.sql).toContain('UPDATE "tasks"');
    expect(wrongTypeQuery).toHaveLength(1);
    expect(wrongTypeQuery[0]?.sql).toContain('"new_link" = "old_link"');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('combines value-copy SQL with link relationship duplication when duplicating link fields', async () => {
    const { FieldValueDuplicateVisitor } = await loadFieldValueDuplicateVisitor();
    const db = createTestDb() as never;
    const linkQuery = { sql: 'insert into junction select ...' };

    mocks.generateStatements.mockReturnValueOnce(ok([linkQuery]));
    mocks.create.mockReturnValueOnce({
      generateStatements: mocks.generateStatements,
    });

    const sourceLink = createField({ id: 'fld_source_link', type: 'link' });
    const newLink = createField({ id: 'fld_new_link', type: 'link' });
    const visitor = FieldValueDuplicateVisitor.create(db, {
      schema: 'public',
      tableName: 'tasks',
      sourceDbFieldName: 'old_link',
      targetDbFieldName: 'new_link',
      newField: newLink as never,
    });

    const queries = visitor.visitLinkField(sourceLink as never)._unsafeUnwrap();

    expect(mocks.create).toHaveBeenCalledWith(db, {
      sourceField: sourceLink,
      newField: newLink,
      schema: 'public',
      tableName: 'tasks',
    });
    expect(queries).toHaveLength(2);
    expect(queries[0]?.sql).toContain('"new_link" = "old_link"');
    expect(queries[1]).toBe(linkQuery);
  });
});
