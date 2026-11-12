import { CellValueMultiplicity, CellValueType, getFormulaSourceBudget } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { dataQueryFormulaExpressionSchema } from './DataQueryExpression';
import {
  bindDataQueryFormulaExpression,
  type DataQueryExpressionBindingContext,
} from './DataQueryExpressionBinding';

const fieldId = `fld${'a'.repeat(16)}`;
const context: DataQueryExpressionBindingContext = {
  formulaSourceBudget: getFormulaSourceBudget(),
  resolveField: () =>
    ok({
      valueType: CellValueType.number(),
      multiplicity: CellValueMultiplicity.single(),
      nullable: true,
    }),
  resolveSource: () => ok({ nullable: false, cardinality: 'one' }),
  parameters: { increment: { type: 'number' } },
};
const formula = (value: string) => ({
  type: 'formula' as const,
  formula: value,
  references: {
    amount: { type: 'field' as const, fieldId },
    increment: { type: 'parameter' as const, name: 'increment' },
  },
});

describe('Teable formula query binding', () => {
  it('retains the source row for formulas without explicit references', () => {
    const expression = { type: 'formula' as const, formula: 'RECORD_ID()', references: {} };
    expect(bindDataQueryFormulaExpression(expression, context)._unsafeUnwrap().recordSource).toBe(
      'root'
    );
    expect(
      bindDataQueryFormulaExpression(expression, {
        ...context,
        localSource: 'child',
      })._unsafeUnwrap().recordSource
    ).toBe('child');
  });
  it('uses Teable operators and preserves typed domain references', () => {
    const result = bindDataQueryFormulaExpression(formula('{amount} + {increment}'), context);
    expect(result.isOk()).toBe(true);
    const bound = result._unsafeUnwrap();
    expect(bound.kind).toBe('formula');
    expect(bound.valueType.toString()).toBe('number');
    expect(bound.multiplicity.toBoolean()).toBe(false);
    expect(bound.nullable).toBe(true);
    expect(bound.references.amount).toMatchObject({
      kind: 'field',
      source: 'root',
      fieldId,
      nullable: true,
    });
    expect(bound.references.amount.valueType.toString()).toBe('number');
    expect(bound.references.amount.multiplicity.toBoolean()).toBe(false);
    expect(bound.references.increment).toMatchObject({
      kind: 'parameter',
      name: 'increment',
      nullable: false,
    });
    expect(bound.references.increment.valueType.toString()).toBe('number');
    expect(bound.references.increment.multiplicity.toBoolean()).toBe(false);
  });

  it('delegates function type inference to existing Teable semantics', () => {
    expect(
      bindDataQueryFormulaExpression(formula('CONCATENATE("total: ", {amount})'), context)
        ._unsafeUnwrap()
        .valueType.toString()
    ).toBe('string');
    expect(
      bindDataQueryFormulaExpression(formula('UNKNOWN_FUNCTION({amount})'), context).isErr()
    ).toBe(true);
    expect(bindDataQueryFormulaExpression(formula('SUM('), context).isErr()).toBe(true);
  });

  it('requires an explicit reference for every alias, including an unselected IF arm', () => {
    expect(
      bindDataQueryFormulaExpression(formula('IF(TRUE, {amount}, {missing})'), context).isErr()
    ).toBe(true);
    expect(bindDataQueryFormulaExpression(formula(`{${fieldId}}`), context).isErr()).toBe(true);
  });

  it('enforces declared parameter types and source cardinality for every declared reference', () => {
    expect(
      bindDataQueryFormulaExpression(
        {
          ...formula('{amount}'),
          references: { amount: { type: 'parameter', name: 'missing' } },
        },
        context
      ).isErr()
    ).toBe(true);
    expect(
      bindDataQueryFormulaExpression(formula('{amount}'), {
        ...context,
        resolveSource: () => ok({ nullable: false, cardinality: 'many' }),
      }).isErr()
    ).toBe(true);
    const local = bindDataQueryFormulaExpression(formula('{amount}'), {
      ...context,
      localSource: 'child',
    })._unsafeUnwrap();
    expect(local.references.amount).toMatchObject({ kind: 'field', source: 'child' });
    expect(
      bindDataQueryFormulaExpression(
        {
          ...formula('{amount}'),
          references: { amount: { type: 'field', fieldId, source: 'root' } },
        },
        { ...context, localSource: 'child' }
      ).isErr()
    ).toBe(true);
  });

  it('allows Teable aggregate functions over multi-value fields but requires scalar output', () => {
    const multiple: DataQueryExpressionBindingContext = {
      ...context,
      resolveField: () =>
        ok({
          valueType: CellValueType.number(),
          multiplicity: CellValueMultiplicity.multiple(),
          nullable: true,
        }),
    };
    const sum = bindDataQueryFormulaExpression(
      {
        type: 'formula',
        formula: 'SUM({amount})',
        references: { amount: { type: 'field', fieldId } },
      },
      multiple
    )._unsafeUnwrap();
    expect(sum.valueType.toString()).toBe('number');
    expect(sum.references.amount.multiplicity.toBoolean()).toBe(true);
    expect(
      bindDataQueryFormulaExpression(
        {
          type: 'formula',
          formula: '{amount}',
          references: { amount: { type: 'field', fieldId } },
        },
        multiple
      ).isErr()
    ).toBe(true);
    // A bare field operand is no longer a v3 scalar expression; only references are.
    expect(dataQueryFormulaExpressionSchema.safeParse({ type: 'field', fieldId }).success).toBe(
      false
    );
  });

  it('keeps array parameters as typed multiple references and date objects filter-only', () => {
    const parameters: DataQueryExpressionBindingContext = {
      ...context,
      parameters: { values: { type: 'number[]' }, date: { type: 'date' } },
    };
    const array = bindDataQueryFormulaExpression(
      {
        type: 'formula',
        formula: 'SUM({values})',
        references: { values: { type: 'parameter', name: 'values' } },
      },
      parameters
    )._unsafeUnwrap();
    expect(array.valueType.toString()).toBe('number');
    expect(array.references.values).toMatchObject({
      kind: 'parameter',
      name: 'values',
    });
    expect(array.references.values.valueType.toString()).toBe('number');
    expect(array.references.values.multiplicity.toBoolean()).toBe(true);
    expect(
      dataQueryFormulaExpressionSchema.safeParse({ type: 'parameter', name: 'values' }).success
    ).toBe(false);
    expect(
      bindDataQueryFormulaExpression(
        {
          type: 'formula',
          formula: '{date}',
          references: { date: { type: 'parameter', name: 'date' } },
        },
        parameters
      ).isErr()
    ).toBe(true);
  });

  it('uses the core TimeZone object, including Intl-supported zones outside the curated list', () => {
    const outsideCurated = bindDataQueryFormulaExpression(
      {
        type: 'formula',
        formula: 'YEAR({created})',
        references: { created: { type: 'system', system: 'createdTime' } },
        timeZone: 'Europe/Kyiv',
      },
      context
    )._unsafeUnwrap();
    expect(outsideCurated.timeZone).toBe('Europe/Kyiv');
    const utc = bindDataQueryFormulaExpression(
      {
        type: 'formula',
        formula: 'YEAR({created})',
        references: { created: { type: 'system', system: 'createdTime' } },
        timeZone: 'UTC',
      },
      context
    )._unsafeUnwrap();
    expect(utc.timeZone).toBe('utc');
    expect(
      bindDataQueryFormulaExpression(
        {
          type: 'formula',
          formula: 'YEAR({created})',
          references: { created: { type: 'system', system: 'createdTime' } },
          timeZone: '+05:00',
        },
        context
      ).isErr()
    ).toBe(true);
  });

  it('rejects alias normalization collisions and the removed computation DSL', () => {
    expect(
      dataQueryFormulaExpressionSchema.safeParse({
        ...formula('{amount}'),
        references: { ' amount ': { type: 'field', fieldId } },
      }).success
    ).toBe(false);
    for (const expression of [
      { type: 'call' },
      { type: 'case' },
      { type: 'option' },
      {
        left: { type: 'field', fieldId },
        operator: 'eq',
        right: { type: 'literal', value: 1 },
      },
      { operand: { type: 'field', fieldId }, operator: 'isNotNull' },
      { type: 'literal', value: 1 },
      { type: 'system', system: 'id' },
    ]) {
      expect(dataQueryFormulaExpressionSchema.safeParse(expression).success).toBe(false);
    }
  });

  it('enforces the configured formula source budget in binding, not public schema', () => {
    const deepLower = {
      type: 'formula' as const,
      formula: `${'LOWER('.repeat(65)}"text"${')'.repeat(65)}`,
      references: {},
    };
    const deepIf = {
      type: 'formula' as const,
      formula: `${'IF(1, 1, '.repeat(65)}1${')'.repeat(65)}`,
      references: {},
    };
    const wide = {
      type: 'formula' as const,
      formula: `CONCATENATE(${Array.from({ length: 32769 }, () => '"a"').join(',')})`,
      references: {},
    };
    for (const expression of [deepLower, deepIf, wide]) {
      expect(dataQueryFormulaExpressionSchema.safeParse(expression).success).toBe(true);
      expect(bindDataQueryFormulaExpression(expression, context).isErr()).toBe(true);
    }
    const relaxed: DataQueryExpressionBindingContext = {
      ...context,
      formulaSourceBudget: { astDepth: 512, visitedNodes: 32768, policyVersion: 1 },
    };
    expect(bindDataQueryFormulaExpression(deepLower, relaxed).isOk()).toBe(true);
    expect(bindDataQueryFormulaExpression(deepIf, relaxed).isOk()).toBe(true);
    expect(bindDataQueryFormulaExpression(wide, relaxed).isErr()).toBe(true);
  });

  it('keeps undeclared reference diagnostics free of formula source text', () => {
    const secret = 'sk_live_private_alias';
    const error = bindDataQueryFormulaExpression(
      { type: 'formula', formula: `{${secret}}`, references: {} },
      context
    )._unsafeUnwrapErr();
    expect(error.code).toBe('data_query.expression_invalid');
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});
