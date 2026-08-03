import { describe, expect, it } from 'vitest';

import { FormulaSqlPgExpressionBuilder } from './FormulaSqlPgExpressionBuilder';
import type { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr, type SqlExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';

class TestExpressionBuilder extends FormulaSqlPgExpressionBuilder {
  public normalizeBranches(left: SqlExpr, right: SqlExpr) {
    return this.coerceBranches(left, right);
  }
}

const createBuilder = (): TestExpressionBuilder =>
  new TestExpressionBuilder({
    typeValidationStrategy: new Pg16TypeValidationStrategy(),
    timeZone: 'utc',
  } as FormulaSqlPgTranslator);

describe('IF branch storage normalization', () => {
  it('normalizes mixed json and scalar number branches before building CASE', () => {
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
    const scalarNumber = makeExpr(
      'integer_column',
      'number',
      false,
      undefined,
      undefined,
      undefined,
      'scalar'
    );

    const result = builder.normalizeBranches(jsonNumber, scalarNumber);

    expect(result.type).toBe('number');
    expect(result.left.storageKind).not.toBe('json');
    expect(result.right.storageKind).not.toBe('json');
    expect(result.left.valueSql).toContain('to_jsonb(json_lookup)');
    expect(result.left.valueSql).toContain('double precision');
    expect(result.right.valueSql).toBe('(integer_column)::double precision');
  });

  it('normalizes nested number branches regardless of which side is json', () => {
    const builder = createBuilder();
    const scalarNumber = makeExpr(
      'integer_column',
      'number',
      false,
      undefined,
      undefined,
      undefined,
      'scalar'
    );
    const jsonNumber = makeExpr(
      'json_lookup',
      'number',
      false,
      undefined,
      undefined,
      undefined,
      'json'
    );

    const result = builder.normalizeBranches(scalarNumber, jsonNumber);

    expect(result.left.storageKind).not.toBe('json');
    expect(result.right.storageKind).not.toBe('json');
    expect(result.right.valueSql).toContain('to_jsonb(json_lookup)');
  });
});
