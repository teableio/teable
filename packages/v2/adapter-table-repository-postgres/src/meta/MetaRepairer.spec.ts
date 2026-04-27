import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createMetaRepairer, getMetaRuleId, type MetaValidationIssue } from './index';

const metaFieldId = 'fldMetaRepair0001';

const asId = (value: string) => ({
  toString: () => value,
});

const createMetaIssue = (): MetaValidationIssue => ({
  fieldId: metaFieldId,
  fieldName: 'Status',
  fieldType: 'lookup',
  category: 'reference',
  severity: 'error',
  message: 'Link field not found: fldMissing',
  details: {
    relatedFieldId: 'fldMissing',
  },
});

const createField = (issue: MetaValidationIssue) => {
  let hasError = false;

  return {
    id: () => asId(issue.fieldId),
    name: () => asId(issue.fieldName),
    type: () => asId(issue.fieldType),
    hasError: () => ({ isError: () => hasError }),
    setHasError: () => {
      hasError = true;
    },
    getHasError: () => hasError,
    accept: () => ok([issue]),
  };
};

const createTable = (fields: ReturnType<typeof createField>[]) =>
  ({
    id: () => asId('tblMetaRepair0001'),
    name: () => asId('Tasks'),
    baseId: () => asId('bseMetaRepair0001'),
    getFields: () => fields,
  }) as never;

const createFakeDb = () => {
  const execute = vi.fn().mockResolvedValue([]);
  const compile = vi.fn(() => ({
    sql: 'update "field" set "has_error" = $1 where "id" = $2',
    parameters: [true, metaFieldId],
  }));
  const where = vi.fn(() => ({ compile, execute }));
  const set = vi.fn(() => ({ where }));
  const updateTable = vi.fn(() => ({ set }));

  return {
    compile,
    db: { updateTable },
    execute,
    set,
    updateTable,
    where,
  };
};

const collect = async <T>(stream: AsyncGenerator<T, void, unknown>): Promise<T[]> => {
  const results: T[] = [];
  for await (const result of stream) {
    results.push(result);
  }
  return results;
};

describe('MetaRepairer', () => {
  it('repairs metadata reference issues by setting field has_error', async () => {
    const issue = createMetaIssue();
    const field = createField(issue);
    const table = createTable([field]);
    const fakeDb = createFakeDb();
    const repairer = createMetaRepairer({ db: fakeDb.db as never });

    const results = await collect(
      repairer.repairRule(table, [table], issue.fieldId, getMetaRuleId(issue), {
        targetStatuses: ['error'],
      })
    );

    expect(results.map((result) => result.status)).toEqual(['running', 'success']);
    expect(results[0]).toMatchObject({
      fieldId: issue.fieldId,
      ruleId: 'meta:reference',
      repair: {
        available: true,
        mode: 'auto',
      },
    });
    expect(results[1]).toMatchObject({
      fieldId: issue.fieldId,
      ruleId: 'meta:reference',
      outcome: 'repaired',
      message: 'Field marked hasError',
      details: {
        missing: ['fldMissing'],
      },
    });
    expect(fakeDb.updateTable).toHaveBeenCalledWith('field');
    expect(fakeDb.set).toHaveBeenCalledWith({ has_error: true });
    expect(fakeDb.where).toHaveBeenCalledWith('id', '=', issue.fieldId);
    expect(field.getHasError()).toBe(true);
  });

  it('supports dry run without mutating field has_error', async () => {
    const issue = createMetaIssue();
    const field = createField(issue);
    const table = createTable([field]);
    const fakeDb = createFakeDb();
    const repairer = createMetaRepairer({ db: fakeDb.db as never });

    const results = await collect(
      repairer.repairField(table, [table], issue.fieldId, {
        dryRun: true,
      })
    );

    expect(results.map((result) => result.status)).toEqual(['running', 'success']);
    expect(results[1]).toMatchObject({
      outcome: 'repaired',
      message: 'Dry run: field will be marked hasError',
      details: {
        statementCount: 1,
        statements: [
          {
            sql: 'update "field" set "has_error" = $1 where "id" = $2',
            parameters: [true, metaFieldId],
          },
        ],
      },
    });
    expect(fakeDb.execute).not.toHaveBeenCalled();
    expect(field.getHasError()).toBe(false);
  });
});
