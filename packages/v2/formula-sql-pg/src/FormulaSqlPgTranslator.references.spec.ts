import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  CellValueMultiplicity,
  CellValueType,
  createMultipleSelectField,
  FieldId,
  FieldName,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createFormulaCompileBudgetPolicy,
  defaultFormulaCompileBudgetLimits,
  FormulaCompileBudget,
} from './FormulaCompileBudget';
import { FormulaSqlPgTranslator, type FormulaSqlPgReference } from './FormulaSqlPgTranslator';
import { makeExpr, type SqlExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';
import {
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

const referenceTranslator = (references: ReadonlyMap<string, FormulaSqlPgReference>) =>
  new FormulaSqlPgTranslator({
    references,
    tableAlias: 'inputs',
    typeValidationStrategy: new Pg16TypeValidationStrategy(),
  });

describe('formula reference-map input graph', () => {
  it('uses parser whitespace extraction but preserves exact alias case', () => {
    const input = {
      valueSql: '"inputs"."arg0"',
      valueType: CellValueType.number(),
      multiplicity: CellValueMultiplicity.single(),
    };
    const translator = referenceTranslator(new Map([['Amount', input]]));
    const root = translator.buildExpressionGraph('{ Amount }')._unsafeUnwrap();
    expect(root.kind).toBe('leaf');
    if (root.kind !== 'leaf') throw new Error('Expected reference leaf');
    expect(root.expression).toMatchObject({
      valueSql: input.valueSql,
      valueType: 'number',
      isArray: false,
    });
    expect(translator.resolveFieldById('amount').isErr()).toBe(true);
    const missing = translator.translateExpression('{amount}')._unsafeUnwrap();
    expect(missing.errorConditionSql).toBe('TRUE');
    expect(missing.errorMessageSql).toContain('#ERROR:REF:missing_field');
  });

  it('retains references and does not fold constant arithmetic or conditional branches', () => {
    const translator = referenceTranslator(new Map());
    const root = translator
      .buildExpressionGraph('IF(TRUE, 1 + 2, ERROR("unused"))')
      ._unsafeUnwrap();
    expect(root.kind).toBe('call');
    if (root.kind !== 'call') throw new Error('Expected IF node');
    expect(root.name).toBe('IF');
    expect(root.args[1].kind).toBe('binary');
    expect(root.args[2].kind).toBe('call');
  });

  it('preserves array, storage, display, and error metadata without resolving a table', () => {
    const field = createMultipleSelectField({
      id: FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Values')._unsafeUnwrap(),
      options: [],
    })._unsafeUnwrap();
    const resolved: SqlExpr = {
      ...makeExpr('"inputs"."arg0"', 'string', true, 'TRUE', "'#ERROR:USER:input'", field, 'json'),
      displayValueSql: "'display'",
    };
    const input = { field, resolveFieldSql: () => ok(resolved) };
    const translator = referenceTranslator(new Map([['values', input]]));
    expect(translator.resolveFieldById('values')._unsafeUnwrap()).toMatchObject(resolved);
    const root = translator.buildExpressionGraph('{values}')._unsafeUnwrap();
    if (root.kind !== 'leaf') throw new Error('Expected reference leaf');
    expect(root.expression).toMatchObject(resolved);
    const expression = translator.translateExpression('{values}')._unsafeUnwrap();
    expect(expression).toMatchObject(resolved);
  });

  it('preserves the reference mode and shared compilation meter across time zones', () => {
    const input = {
      valueSql: '"inputs"."arg0"',
      valueType: CellValueType.number(),
      multiplicity: CellValueMultiplicity.single(),
    };
    const budget = new FormulaCompileBudget({
      mode: 'enforce',
      policyVersion: 1,
      policy: createFormulaCompileBudgetPolicy(defaultFormulaCompileBudgetLimits),
    });
    const original = new FormulaSqlPgTranslator({
      references: new Map([['amount', input]]),
      tableAlias: 'inputs',
      budget,
      typeValidationStrategy: new Pg16TypeValidationStrategy(),
    });
    const translator = original.withTimeZone('Asia/Shanghai');
    expect(translator.timeZone).toBe('Asia/Shanghai');
    expect(translator.resolveFieldById('amount')._unsafeUnwrap()).toMatchObject({
      valueSql: input.valueSql,
      valueType: 'number',
    });
    const expression = translator.translateExpression('{amount} + 1')._unsafeUnwrap();
    const metrics = translator.getCompileBudgetMetrics(expression)!;
    expect(metrics.visitedNodes).toBeGreaterThan(0);
    original.translateExpression('{amount} + 1')._unsafeUnwrap();
    expect(translator.getCompileBudgetMetrics(expression)!.visitedNodes).toBeGreaterThan(
      metrics.visitedNodes
    );
  });

  it('accepts canonical domain metadata for parameter and system reference values', () => {
    const translator = new FormulaSqlPgTranslator({
      references: new Map([
        [
          'amount',
          {
            valueSql: '"inputs"."arg0"',
            valueType: CellValueType.number(),
            multiplicity: CellValueMultiplicity.single(),
          },
        ],
      ]),
      tableAlias: 'inputs',
      typeValidationStrategy: new Pg16TypeValidationStrategy(),
    });
    expect(translator.resolveFieldById('amount')._unsafeUnwrap()).toMatchObject({
      valueType: 'number',
      isArray: false,
      storageKind: 'scalar',
    });
    expect(translator.translateExpression('{amount} + 1').isOk()).toBe(true);
  });

  it('enforces the configured reference compilation limits without downgrading the error', () => {
    const translator = new FormulaSqlPgTranslator({
      references: new Map([
        [
          'amount',
          {
            valueSql: '"inputs"."arg0"',
            valueType: CellValueType.number(),
            multiplicity: CellValueMultiplicity.single(),
          },
        ],
      ]),
      tableAlias: 'inputs',
      typeValidationStrategy: new Pg16TypeValidationStrategy(),
      compileBudget: {
        mode: 'enforce',
        policyVersion: 1,
        policy: createFormulaCompileBudgetPolicy({
          ...defaultFormulaCompileBudgetLimits,
          visitedNodes: 0,
        }),
      },
    });
    const translated = translator.translateExpression('{amount} + 1');
    expect(translated.isErr()).toBe(true);
    if (translated.isErr())
      expect(translated.error.code).toBe('validation.limit.formula_compile_nodes_max');
  });
});

describe('formula reference-map input SQL semantics', () => {
  let container: IV2NodeTestContainer;
  let fixture: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    fixture = await createFormulaTestTable(container, [], {
      profile: 'minimal',
      fieldTypes: ['singleLineText', 'number', 'createdBy'],
    });
  });

  afterAll(async () => {
    await container?.dispose();
  });

  const execute = async (
    sources: ReadonlyArray<string>,
    input: { amount: number | null; text: string | null } = { amount: null, text: 'AbC' }
  ) => {
    const translator = new FormulaSqlPgTranslator({
      references: new Map<string, FormulaSqlPgReference>([
        [
          'amount',
          {
            valueSql: '"inputs"."arg0"',
            valueType: CellValueType.number(),
            multiplicity: CellValueMultiplicity.single(),
          },
        ],
        [
          'text',
          {
            valueSql: '"inputs"."arg1"',
            valueType: CellValueType.string(),
            multiplicity: CellValueMultiplicity.single(),
          },
        ],
      ]),
      tableAlias: 'inputs',
      typeValidationStrategy: fixture.translator.typeValidationStrategy,
    });
    const expressions = translator.translateExpressions(sources)._unsafeUnwrap();
    const projection = translator
      .renderExpressions(expressions, (raw) =>
        raw
          .flatMap((expression, index) => [
            `${expression.valueSql} AS "value${index}"`,
            `COALESCE(${expression.errorConditionSql ?? 'FALSE'}, FALSE) AS "error${index}"`,
          ])
          .join(', ')
      )
      ._unsafeUnwrap();
    const result = await sql<Record<string, unknown>>`
      SELECT outputs.*
      FROM (SELECT ${input.amount}::double precision AS "arg0", ${input.text}::text AS "arg1") AS inputs
      CROSS JOIN LATERAL ${sql.raw(projection)} AS outputs
    `.execute(fixture.db);
    return { rows: result.rows, projection };
  };

  it('uses Teable zero-coercion for NULL arithmetic instead of PostgreSQL NULL propagation', async () => {
    const result = await execute(['{amount} + 2', '{amount} * 2', '{amount} - 2']);
    expect(result.rows).toEqual([
      { value0: 2, error0: false, value1: 0, error1: false, value2: -2, error2: false },
    ]);
  });

  it('reuses LOWER, IF and ERROR semantics for selected and unselected branches', async () => {
    const result = await execute([
      'LOWER({text})',
      'IF(TRUE, LOWER({text}), ERROR("unused"))',
      'IS_ERROR(IF(FALSE, LOWER({text}), ERROR("selected")))',
    ]);
    expect(result.rows).toEqual([
      { value0: 'abc', error0: false, value1: 'abc', error1: false, value2: true, error2: false },
    ]);
  });

  it('keeps missing references as formula errors even in an otherwise valid program', async () => {
    const result = await execute(['{missing}', 'IF(TRUE, LOWER({text}), {missing})']);
    expect(result.rows).toEqual([{ value0: null, error0: true, value1: 'abc', error1: false }]);
  });

  it('shares the existing lowering across independent outputs', async () => {
    const shared = 'LEN(LOWER({text}))';
    const result = await execute([`${shared} + 1`, `${shared} * 2`]);
    expect(result.rows).toEqual([{ value0: 4, error0: false, value1: 6, error1: false }]);
    expect(result.projection.match(/LOWER\(/g)).toHaveLength(1);
  });

  it('keeps a shared Teable error branch lazy for unselected outputs', async () => {
    const invalid = 'ERROR("unused")';
    const result = await execute(
      [`IF({amount}>0, "first", ${invalid})`, `IF({amount}<0, ${invalid}, "second")`],
      { amount: 10, text: 'constant input' }
    );
    expect(result.rows).toEqual([
      { value0: 'first', error0: false, value1: 'second', error1: false },
    ]);
  });

  it.each([true, false])(
    'uses actor snapshot titles and only an explicit permitted fallback (%s)',
    async (allowFallback) => {
      const field = fixture.fieldsByType.createdBy;
      if (!field) throw new Error('Missing createdBy fixture field');
      const translator = new FormulaSqlPgTranslator({
        references: new Map([
          [
            'actor',
            {
              field,
              resolveFieldSql: () => ok(makeExpr('"inputs"."snapshot"', 'unknown')),
              ...(allowFallback ? { actorIdFallbackSql: '"inputs"."actor_id"' } : {}),
            },
          ],
        ]),
        tableAlias: 'inputs',
        typeValidationStrategy: fixture.translator.typeValidationStrategy,
      });
      const expr = translator.translateExpression('LOWER({actor})')._unsafeUnwrap();
      const rendered = translator.renderSql(expr)._unsafeUnwrap();
      const result = await sql<{ title: unknown }>`
      select ${sql.raw(rendered)} as title from (
        select null::jsonb as snapshot, 'Fallback Actor'::text as actor_id
      ) as inputs
    `.execute(fixture.db);
      expect(result.rows).toEqual([{ title: allowFallback ? 'fallback actor' : null }]);
      const snapshot = await sql<{ title: unknown }>`
      select ${sql.raw(rendered)} as title from (
        select ${JSON.stringify({ id: 'actor', title: 'Snapshot Actor', email: 'private-sentinel' })}::jsonb as snapshot,
          'Fallback Actor'::text as actor_id
      ) as inputs
    `.execute(fixture.db);
      expect(snapshot.rows).toEqual([{ title: 'snapshot actor' }]);
    }
  );

  it('preserves supplied Field metadata without permitting field-name or field-id fallback', () => {
    const field = fixture.fieldsByType.singleLineText;
    if (!field) throw new Error('Missing text fixture field');
    const input = makeExpr(
      '"inputs"."arg1"',
      'string',
      false,
      undefined,
      undefined,
      field,
      'scalar'
    );
    const translator = referenceTranslator(
      new Map([['onlyAlias', { field, resolveFieldSql: () => ok(input) }]])
    );
    expect(translator.translateExpression('{onlyAlias}')._unsafeUnwrap().field).toBe(field);
    expect(translator.resolveFieldById(field.id().toString()).isErr()).toBe(true);
    expect(translator.resolveFieldById(field.name().toString()).isErr()).toBe(true);
  });
});
