import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createFormulaTestContainer,
  createFormulaTestTable,
  executeFormulaAsText,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

const coreExpression =
  'SUM(ARRAY_COMPACT(TEXTSPLIT(REGEXP_REPLACE({SingleLineText}, "[^0-9.]+", ":"), ":")))';

const nestedIf = (depth: number): string => {
  let expression = coreExpression;
  for (let index = 0; index < depth; index++) {
    expression = `IF({Number}>${index}, ${expression}, 0)`;
  }
  return expression;
};

describe('formula compiler acceptance', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(
      container,
      [
        { name: 'Core', expression: coreExpression },
        { name: 'Repeated', expression: `${coreExpression} + ${coreExpression}` },
        { name: 'Shared', expression: coreExpression },
        { name: 'Left', expression: '{Shared} + 1' },
        { name: 'Right', expression: '{Shared} * 2' },
        { name: 'Diamond', expression: '{Left} + {Right}' },
        { name: 'MixedText', expression: 'IF({Number}>0, {Number}%100, "")' },
        {
          name: 'MixedTextBlank',
          expression:
            'VALUE(IF({Number}>0, IF({Number}<20, "", IF({Number}<20, "", IF({Number}>0, {MixedText}, ""))), ""))',
        },
        { name: 'MixedTextValue', expression: 'VALUE(IF({Number}>0, {MixedText}, ""))' },
        {
          name: 'DeadRegex',
          expression:
            'IF({Number}>0, "safe", CONCATENATE(REGEXP_REPLACE({SingleLineText}, "[", "x"), REGEXP_REPLACE({SingleLineText}, "[", "x")))',
        },
        {
          name: 'DeadError',
          expression: 'IS_ERROR(IF({Number}>0, 7, ERROR("branch error")))',
        },
        {
          name: 'LiveError',
          expression: 'IS_ERROR(IF({Number}>0, ERROR("branch error"), 7))',
        },
        {
          name: 'SharedError',
          expression: 'IS_ERROR(IF({Number}>0, {Shared} / 0, {Shared} / 0))',
        },
      ],
      { profile: 'minimal', fieldTypes: ['singleLineText', 'number'] }
    );
    const numberField = testTable.fieldsByType.number;
    if (!numberField) throw new Error('Missing Number field');
    const column = numberField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const tableName = testTable.table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    await sql`UPDATE ${sql.table(tableName)} SET ${sql.ref(column)} = 10`.execute(testTable.db);
  });

  afterAll(async () => {
    await container?.dispose();
  });

  const render = (expression: string): string =>
    testTable.translator.renderSql(
      testTable.translator.translateExpression(expression)._unsafeUnwrap()
    );

  it('executes the incident array normalization formula with a bounded SQL size', async () => {
    expect(render(coreExpression).length).toBeLessThan(20_000);
    await expect(executeFormulaAsText(testTable, 'Core')).resolves.toBe('10');
  });

  it('coerces mixed formula fields before combining blank and numeric branches', async () => {
    await expect(executeFormulaAsText(testTable, 'MixedTextBlank')).resolves.toBeNull();
    await expect(executeFormulaAsText(testTable, 'MixedTextValue')).resolves.toBe('10');
  });

  it('shares expensive identical subexpressions without changing their result', async () => {
    const singleSize = render(coreExpression).length;
    const repeatedSize = render(`${coreExpression} + ${coreExpression}`).length;
    // Fixed room for addition and error handling, not a second expensive subtree.
    expect(repeatedSize).toBeLessThan(singleSize + 2_000);
    await expect(executeFormulaAsText(testTable, 'Repeated')).resolves.toBe('20');
  });

  it('shares a common subtree across different output formulas', async () => {
    const translator = testTable.translator;
    const expressions = translator
      .translateExpressions([`${coreExpression} + 1`, `${coreExpression} * 2`])
      ._unsafeUnwrap();
    const projection = translator.renderExpressions(expressions, (raw) =>
      raw
        .map((expression, index) => `(${expression.valueSql})::text AS "output${index}"`)
        .join(', ')
    );
    expect(projection.split("'[^0-9.]+'")).toHaveLength(2);
    const tableName = testTable.table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const result = await sql<{ output0: string; output1: string }>`
      SELECT outputs.* FROM ${sql.table(tableName)} AS t
      CROSS JOIN LATERAL ${sql.raw(projection)} AS outputs
    `.execute(testTable.db);
    expect(result.rows).toEqual([{ output0: '11', output1: '20' }]);
  });

  it('shares a dependency reached through two formula fields', async () => {
    const sharedSize = render('{Shared}').length;
    expect(render('{Diamond}').length).toBeLessThan(sharedSize + 6_000);
    await expect(executeFormulaAsText(testTable, 'Diamond')).resolves.toBe('31');
  });

  const executeOutputs = async (sources: ReadonlyArray<string>) => {
    const translator = testTable.translator;
    const expressions = translator.translateExpressions(sources)._unsafeUnwrap();
    const projection = translator.renderExpressions(expressions, (raw) =>
      raw
        .flatMap((expression, index) => [
          `${expression.valueSql} AS "output${index}"`,
          `COALESCE(${expression.errorConditionSql ?? 'FALSE'}, FALSE) AS "error${index}"`,
        ])
        .join(', ')
    );
    const tableName = testTable.table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const result = await sql<Record<string, unknown>>`
      SELECT outputs.*,
        pg_typeof(outputs.output0)::text AS type0,
        pg_typeof(outputs.output1)::text AS type1
      FROM ${sql.table(tableName)} AS t
      CROSS JOIN LATERAL ${sql.raw(projection)} AS outputs
    `.execute(testTable.db);
    return result.rows;
  };

  it('preserves physical array and numeric output types when sharing an array subtree', async () => {
    const array = 'TEXTSPLIT(CONCATENATE({Number}, ":2"), ":")';
    await expect(executeOutputs([array, `SUM(${array})`])).resolves.toEqual([
      {
        output0: ['10', '2'],
        output1: 12,
        error0: false,
        error1: false,
        type0: 'jsonb',
        type1: 'double precision',
      },
    ]);
  });

  it('keeps a shared invalid regex lazy when both output branches are unselected', async () => {
    const invalidRegex = 'REGEXP_REPLACE({SingleLineText}, "[", "x")';
    await expect(
      executeOutputs([
        `IF({Number}>0, "first", ${invalidRegex})`,
        `IF({Number}<0, ${invalidRegex}, "second")`,
      ])
    ).resolves.toEqual([
      {
        output0: 'first',
        output1: 'second',
        error0: false,
        error1: false,
        type0: 'text',
        type1: 'text',
      },
    ]);
  });

  it('isolates error inspection from a normal output sharing the same error subtree', async () => {
    const failure = 'IF({Number}>0, ERROR("shared failure"), 1)';
    await expect(
      executeOutputs([`IS_ERROR(${failure})`, `IF({Number}>0, 7, ${failure})`])
    ).resolves.toEqual([
      {
        output0: true,
        output1: 7,
        error0: false,
        error1: false,
        type0: 'boolean',
        type1: 'integer',
      },
    ]);
  });

  it('keeps SQL growth linear across 1, 2, 4 and 8 conditional levels', () => {
    const sizes = [1, 2, 4, 8].map((depth) => render(nestedIf(depth)).length);
    for (let index = 1; index < sizes.length; index++) {
      expect(sizes[index]).toBeLessThan(sizes[0] + 2_000 * (2 ** index - 1));
    }
    expect(sizes[3]).toBeLessThan(40_000);
  });

  it('does not evaluate invalid PostgreSQL operations from a dead IF branch', async () => {
    await expect(executeFormulaAsText(testTable, 'DeadRegex')).resolves.toBe('safe');
  });

  it('preserves selected and unselected branch errors after sharing', async () => {
    await expect(executeFormulaAsText(testTable, 'DeadError')).resolves.toBe('false');
    await expect(executeFormulaAsText(testTable, 'LiveError')).resolves.toBe('true');
    await expect(executeFormulaAsText(testTable, 'SharedError')).resolves.toBe('true');
  });
});
