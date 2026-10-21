import { FunctionName } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { FormulaSqlPgFunctions } from './FormulaSqlPgFunctions';
import type { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr, type SqlExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';

const createFunctions = () => {
  const functions = new FormulaSqlPgFunctions({
    typeValidationStrategy: new Pg16TypeValidationStrategy(),
    timeZone: 'utc',
  } as FormulaSqlPgTranslator);
  return (name: FunctionName, params: SqlExpr[]) => {
    const handler = functions.getHandlers()[name];
    if (!handler) throw new Error(`Missing function handler: ${name}`);
    return handler(params);
  };
};

const jsonArray = (sql: string) =>
  makeExpr(sql, 'string', true, undefined, undefined, undefined, 'json');

// This exercises the boundary between conditional and array functions, where
// losing storage metadata previously sent a complete CASE into type probing.
describe('conditional array storage', () => {
  it.each([FunctionName.If, FunctionName.Switch])(
    '%s preserves TEXTSPLIT storage for outer ARRAY_COMPACT',
    (name) => {
      const call = createFunctions();
      const split = call(FunctionName.TextSplit, [
        makeExpr("'12:34'", 'string'),
        makeExpr("':'", 'string'),
      ]);
      const conditional = call(
        name,
        name === FunctionName.If
          ? [makeExpr('TRUE', 'boolean'), split, jsonArray("'[]'::jsonb")]
          : [makeExpr("'a'", 'string'), makeExpr("'a'", 'string'), split]
      );
      expect(conditional.isArray).toBe(true);
      expect(conditional.storageKind).toBe('json');
      const compact = call(FunctionName.ArrayCompact, [conditional]);
      expect(compact.valueSql).not.toContain('pg_typeof');
      expect(compact.valueSql).not.toContain('pg_input_is_valid');
      expect(compact.valueSql.split('string_to_array').length - 1).toBe(1);
    }
  );

  it.each([FunctionName.If, FunctionName.Switch])(
    '%s normalizes native SQL arrays before merging with JSONB',
    (name) => {
      const call = createFunctions();
      const native = makeExpr(
        'native_array',
        'string',
        true,
        undefined,
        undefined,
        undefined,
        'array'
      );
      const json = jsonArray('json_array');
      const conditional = call(
        name,
        name === FunctionName.If
          ? [makeExpr('TRUE', 'boolean'), native, json]
          : [makeExpr("'a'", 'string'), makeExpr("'a'", 'string'), native, json]
      );
      expect(conditional.storageKind).toBe('json');
      expect(conditional.valueSql).toContain('to_jsonb(native_array)');
      const compact = call(FunctionName.ArrayCompact, [conditional]);
      expect(compact.valueSql).not.toContain('pg_typeof');
    }
  );

  it('preserves SQL NULL in a generated JSONB-array branch', () => {
    const conditional = createFunctions()(FunctionName.If, [
      makeExpr('TRUE', 'boolean'),
      jsonArray('NULL::jsonb'),
      jsonArray("'[]'::jsonb"),
    ]);
    expect(conditional.valueSql).toContain('THEN NULL::jsonb ELSE');
  });

  it('keeps a blank numeric-array IF branch NULL and preserves array storage', () => {
    const conditional = createFunctions()(FunctionName.If, [
      makeExpr('TRUE', 'boolean'),
      makeExpr("''", 'string'),
      makeExpr("'[1,2]'::jsonb", 'number', true, undefined, undefined, undefined, 'json'),
    ]);
    expect(conditional.valueSql).toContain('THEN NULL ELSE');
    expect(conditional.storageKind).toBe('json');
    expect(conditional.valueType).toBe('number');
  });

  it('does not advertise array storage after coercing mixed scalar and array branches', () => {
    const conditional = createFunctions()(FunctionName.If, [
      makeExpr('TRUE', 'boolean'),
      jsonArray('\'["a"]\'::jsonb'),
      makeExpr("'b'", 'string'),
    ]);
    expect(conditional.isArray).toBe(false);
    expect(conditional.storageKind).not.toBe('json');
  });
});
