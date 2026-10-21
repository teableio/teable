import { describe, expect, it } from 'vitest';

import { FormulaSqlPgExpressionBuilder } from './FormulaSqlPgExpressionBuilder';
import type { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr, type SqlExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';

class TestExpressionBuilder extends FormulaSqlPgExpressionBuilder {
  public mergeSwitchResults(results: SqlExpr[], defaultResult?: SqlExpr) {
    return this.coerceSwitchResults(results, defaultResult);
  }
}

const createBuilder = (): TestExpressionBuilder =>
  new TestExpressionBuilder({
    typeValidationStrategy: new Pg16TypeValidationStrategy(),
    timeZone: 'utc',
  } as FormulaSqlPgTranslator);

const scalarNumber = (sql: string): SqlExpr =>
  makeExpr(sql, 'number', false, undefined, undefined, undefined, 'scalar');

describe('SWITCH branch storage normalization', () => {
  it('normalizes json-storage number results to the scalar seed type', () => {
    const builder = createBuilder();
    const jsonNumber = makeExpr(
      'json_lookup',
      'number',
      false,
      undefined,
      undefined,
      undefined,
      'json'
    );

    const result = builder.mergeSwitchResults([scalarNumber('integer_column'), jsonNumber]);

    expect(result.type).toBe('number');
    expect(result.isArray).toBe(false);
    for (const branch of result.results) {
      expect(branch.storageKind).not.toBe('json');
    }
    expect(result.results[1]?.valueSql).toContain('to_jsonb(json_lookup)');
    expect(result.results[1]?.valueSql).toContain('double precision');
    expect(result.results[0]?.valueSql).toBe('(integer_column)::double precision');
  });

  it('coerces every branch to string when the default is a multi-value json column', () => {
    const builder = createBuilder();
    const multiLink = makeExpr(
      'link_column',
      'string',
      true,
      undefined,
      undefined,
      undefined,
      'json'
    );

    const result = builder.mergeSwitchResults(
      [scalarNumber('numeric_a'), scalarNumber('numeric_b')],
      multiLink
    );

    expect(result.type).toBe('string');
    expect(result.isArray).toBe(false);
    expect(result.results[0]?.valueSql).not.toBe('numeric_a');
    expect(result.results[1]?.valueSql).not.toBe('numeric_b');
    expect(result.defaultValueSql).toBeDefined();
    expect(result.defaultValueSql).toContain('jsonb_array_elements');
  });

  it('keeps raw branches when results and default share the seed type', () => {
    const builder = createBuilder();
    const defaultBranch = scalarNumber('numeric_default');

    const result = builder.mergeSwitchResults(
      [scalarNumber('numeric_a'), scalarNumber('numeric_b')],
      defaultBranch
    );

    expect(result.type).toBe('number');
    expect(result.results.map((branch) => branch.valueSql)).toEqual(['numeric_a', 'numeric_b']);
    expect(result.defaultValueSql).toBe('numeric_default');
  });

  it('keeps raw branches when the default is a blank literal', () => {
    const builder = createBuilder();
    const blankDefault = makeExpr(`''`, 'string', false, undefined, undefined);

    const result = builder.mergeSwitchResults([scalarNumber('numeric_a')], blankDefault);

    expect(result.type).toBe('number');
    expect(result.results[0]?.valueSql).toBe('numeric_a');
    expect(result.defaultValueSql).toBe(`''`);
  });

  // T6998: string-literal result branches with a number-typed default must not
  // take the raw early-return — Postgres would type the CASE as double
  // precision while field metadata stays string, and downstream text
  // fallbacks like COALESCE(<ref>, '') then fail with
  // invalid input syntax for type double precision: "".
  it('coerces a numeric default to string when result branches are string literals', () => {
    const builder = createBuilder();
    const stringBranch = (sql: string): SqlExpr => makeExpr(sql, 'string', false);

    const result = builder.mergeSwitchResults(
      [stringBranch(`'0'`), stringBranch(`'0'`), stringBranch(`'0'`)],
      scalarNumber('numeric_default')
    );

    expect(result.type).toBe('string');
    expect(result.isArray).toBe(false);
    expect(result.defaultValueSql).toBeDefined();
    expect(result.defaultValueSql).not.toBe('numeric_default');
    expect(result.defaultValueSql).toContain('numeric_default');
  });
});
