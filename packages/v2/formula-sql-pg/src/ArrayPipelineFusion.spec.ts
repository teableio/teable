import { createV2PostgresPgliteDb } from '@teable/v2-adapter-db-postgres-pglite';
import { FunctionName } from '@teable/v2-core';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FormulaExpressionGraph } from './FormulaExpressionGraph';
import { FormulaSqlPgArrayFusion } from './FormulaSqlPgArrayFusion';
import { FormulaSqlPgFunctions } from './FormulaSqlPgFunctions';
import { FormulaSqlPgLowering } from './FormulaSqlPgLowering';
import type { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr, type SqlExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';

const translator = {
  typeValidationStrategy: new Pg16TypeValidationStrategy(),
  timeZone: 'utc',
} as FormulaSqlPgTranslator;
const functions = new FormulaSqlPgFunctions(translator);
const fusion = new FormulaSqlPgArrayFusion(translator);
const call = (name: FunctionName, args: SqlExpr[]) => {
  const handler = functions.getHandlers()[name];
  if (!handler) throw new Error(`Missing handler: ${name}`);
  return handler(args);
};
const legacy = (text: SqlExpr, delimiter: SqlExpr) =>
  call(FunctionName.Sum, [
    call(FunctionName.ArrayCompact, [call(FunctionName.TextSplit, [text, delimiter])]),
  ]);
const projection = (expr: SqlExpr) => `CASE WHEN ${expr.errorConditionSql ?? 'FALSE'}
  THEN ${expr.errorMessageSql ?? "'error'"} ELSE (${expr.valueSql})::text END`;

describe('SUM / ARRAY_COMPACT / TEXTSPLIT fusion', () => {
  let db: Kysely<unknown>;
  beforeAll(async () => {
    db = await createV2PostgresPgliteDb({ pg: { connectionString: 'memory://' } });
  });
  afterAll(async () => db?.destroy());

  it('matches the original SQL for blanks, delimiters, invalid casts and order-sensitive sums', async () => {
    const text = makeExpr('c.input', 'string');
    const delimiter = makeExpr('c.delimiter', 'string');
    const before = projection(legacy(text, delimiter));
    const after = projection(fusion.sumCompactTextSplit(text, delimiter));
    const result = await sql
      .raw(
        `WITH cases AS (
      SELECT input, delimiter FROM (VALUES (NULL::text), (''), (','), (',,,'),
        ('0'), ('1,,2,-3'), (' 1 , ,2 '), ('junk,2,NaN,Infinity,-Infinity'),
        ('1e16,1,-1e16'), ('1e16,-1e16,1'), ('-0,0,1e-10'),
        ('true,false,null,[]'), ('1.2,3e2,-4.25'), ('001,+2,$3,5%')) inputs(input)
      CROSS JOIN (VALUES (NULL::text), (''), (','), ('::'), ('1')) delimiters(delimiter)
    ) SELECT * FROM (SELECT c.*, ${before} AS expected, ${after} AS actual
      FROM cases c) results WHERE expected IS DISTINCT FROM actual`
      )
      .execute(db);
    expect(result.rows).toEqual([]);
  });

  it('preserves source error channels and does not evaluate an unused IF branch', async () => {
    const text = makeExpr('c.input', 'string', false, 'c.failed', "'input error'");
    const delimiter = makeExpr("','", 'string');
    const before = legacy(text, delimiter);
    const after = fusion.sumCompactTextSplit(text, delimiter);
    const result = await sql
      .raw(
        `SELECT ${projection(before)} AS expected,
      ${projection(after)} AS actual FROM (VALUES ('1,2', TRUE), ('1,2', FALSE)) c(input,failed)`
      )
      .execute(db);
    expect(result.rows).toEqual([
      { expected: 'input error', actual: 'input error' },
      { expected: '3', actual: '3' },
    ]);
    const graph = new FormulaExpressionGraph();
    const leaf = (expression: SqlExpr) => graph.intern({ kind: 'leaf', expression });
    const split = graph.intern({
      kind: 'call',
      name: FunctionName.TextSplit,
      args: [leaf(makeExpr('(1 / c.zero)::text', 'string')), leaf(delimiter)],
    });
    const compact = graph.intern({ kind: 'call', name: FunctionName.ArrayCompact, args: [split] });
    const sum = graph.intern({ kind: 'call', name: FunctionName.Sum, args: [compact] });
    const conditional = graph.intern({
      kind: 'call',
      name: FunctionName.If,
      args: [leaf(makeExpr('c.enabled', 'boolean')), sum, leaf(makeExpr('7', 'number'))],
    });
    const lowering = new FormulaSqlPgLowering(translator);
    const expression = lowering.lower(conditional);
    const rendered = lowering.bindings.render(expression.valueSql);
    expect(rendered).toContain('unnest(string_to_array');
    expect(rendered).not.toContain('jsonb_agg');
    await sql.raw('CREATE TEMP TABLE lazy_inputs (enabled boolean, zero integer)').execute(db);
    await sql.raw('INSERT INTO lazy_inputs VALUES (FALSE, 0)').execute(db);
    const lazy = await sql
      .raw(
        `SELECT ${rendered} AS value
      FROM lazy_inputs c`
      )
      .execute(db);
    expect(lazy.rows).toEqual([{ value: 7 }]);
  });

  it('preserves shared producer bindings when another consumer needs the array', () => {
    const graph = new FormulaExpressionGraph();
    const text = graph.intern({ kind: 'leaf', expression: makeExpr('c.input', 'string') });
    const delimiter = graph.intern({ kind: 'leaf', expression: makeExpr("','", 'string') });
    const split = graph.intern({
      kind: 'call',
      name: FunctionName.TextSplit,
      args: [text, delimiter],
    });
    const compact = graph.intern({ kind: 'call', name: FunctionName.ArrayCompact, args: [split] });
    const sum = graph.intern({ kind: 'call', name: FunctionName.Sum, args: [compact] });
    const lowering = new FormulaSqlPgLowering(translator);
    const [sumSql] = lowering.lowerAll([sum, compact]);
    const rendered = lowering.bindings.render(sumSql.valueSql);
    expect(rendered).not.toContain('unnest(string_to_array');
    expect(rendered).toContain('jsonb_agg');
    expect(rendered.match(/string_to_array/g)).toHaveLength(1);
  });
});
