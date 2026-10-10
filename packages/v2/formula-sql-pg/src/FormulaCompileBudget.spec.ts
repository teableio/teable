import { BaseId, FieldId, FieldName, FormulaExpression, Table, TableName } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import {
  checkFormulaSqlBudget,
  FormulaCompileBudget,
  createFormulaCompileBudgetPolicy,
  defaultFormulaCompileBudgetLimits,
  type FormulaBudgetMetric,
  type FormulaBudgetViolation,
  type FormulaCompileBudgetOptions,
} from './FormulaCompileBudget';
import { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';

const options = (
  limits: Partial<Record<FormulaBudgetMetric, number>> = {},
  mode: 'observe' | 'enforce' = 'enforce',
  onViolation?: (violation: FormulaBudgetViolation) => void
): FormulaCompileBudgetOptions => ({
  policy: createFormulaCompileBudgetPolicy({ ...defaultFormulaCompileBudgetLimits, ...limits }),
  policyVersion: 1,
  mode,
  onViolation,
});

const createTranslator = (
  compileBudget?: FormulaCompileBudgetOptions,
  budget?: FormulaCompileBudget
) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Budget')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(FieldName.create('Input')._unsafeUnwrap())
    .done();
  for (const [index, name, expression] of [
    [1, 'Shared', `LEN({fld${'a'.repeat(16)}})`],
    [2, 'Parent', `{fld${'b'.repeat(16)}} + 1`],
  ] as const) {
    builder
      .field()
      .formula()
      .withId(FieldId.create(`fld${String.fromCharCode(97 + index).repeat(16)}`)._unsafeUnwrap())
      .withName(FieldName.create(name)._unsafeUnwrap())
      .withExpression(FormulaExpression.create(expression)._unsafeUnwrap())
      .done();
  }
  builder.view().defaultGrid().done();
  return new FormulaSqlPgTranslator({
    table: builder.build()._unsafeUnwrap(),
    tableAlias: 't',
    compileBudget,
    budget,
    typeValidationStrategy: new Pg16TypeValidationStrategy(),
    resolveFieldSql: (field) =>
      ok(makeExpr('"t"."input"', 'string', false, undefined, undefined, field)),
  });
};

describe('formula compilation budgets', () => {
  it('shares cumulative compilation work across CTE translators but never across independent statements', () => {
    const source = 'LEN({Input}) + 1';
    const baseline = createTranslator(options());
    const expression = baseline.translateExpression(source)._unsafeUnwrap();
    const max = baseline.getCompileBudgetMetrics(expression)!.visitedNodes;
    const config = options({ visitedNodes: max });
    const shared = new FormulaCompileBudget(config);
    expect(createTranslator(undefined, shared).translateExpression(source).isOk()).toBe(true);
    expect(
      createTranslator(undefined, shared).translateExpression(source)._unsafeUnwrapErr()
    ).toMatchObject({
      code: 'validation.limit.formula_compile_nodes_max',
      details: { metric: 'visitedNodes', max },
    });
    expect(createTranslator(config).translateExpression(source).isOk()).toBe(true);
    const violations: FormulaBudgetViolation[] = [];
    const observed = new FormulaCompileBudget(
      options({ visitedNodes: max }, 'observe', (violation) => violations.push(violation))
    );
    const first = createTranslator(undefined, observed).translateExpression(source)._unsafeUnwrap();
    const second = createTranslator(undefined, observed)
      .translateExpression(source)
      ._unsafeUnwrap();
    expect(first.valueSql).toBe(expression.valueSql);
    expect(second.valueSql).toBe(expression.valueSql);
    expect(violations.map(({ metric }) => metric)).toEqual(['visitedNodes']);
  });

  it('does not reuse another compiler meter certification or accept a conflicting policy', () => {
    const config = options();
    const meter = new FormulaCompileBudget(config);
    expect(() => createTranslator({ ...config, mode: 'observe' }, meter)).toThrow();
    expect(() => createTranslator({ ...config, policyVersion: 2 }, meter)).toThrow();
    expect(() => createTranslator(options(), meter)).toThrow();
    const original = createTranslator(config);
    const expression = original.translateExpression('1')._unsafeUnwrap();
    original.renderSql(expression)._unsafeUnwrap();
    const constrained = createTranslator(
      undefined,
      new FormulaCompileBudget(options({ sqlBytes: 0 }))
    );
    expect(constrained.renderSql(expression)._unsafeUnwrapErr().code).toBe(
      'validation.limit.formula_sql_bytes_max'
    );
  });

  it('rejects recursive source shapes before parsing or visiting can exhaust the stack', () => {
    for (const source of [
      '-'.repeat(512) + '1',
      Array(512).fill('1').join('+'),
      'IF(TRUE,'.repeat(96) + '1' + ',0)'.repeat(96),
    ]) {
      const result = createTranslator(options()).translateExpression(source);
      expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_depth_max');
    }
  });
  it('rejects invalid configuration immediately and snapshots caller-owned policy settings', () => {
    const limits = { ...defaultFormulaCompileBudgetLimits, sqlBytes: 10 };
    const policy = createFormulaCompileBudgetPolicy(limits);
    limits.sqlBytes = 100;
    expect(policy.check('sqlBytes', 11)).toEqual({ metric: 'sqlBytes', attempted: 11, max: 10 });
    expect(() => createFormulaCompileBudgetPolicy({ ...limits, sqlBytes: NaN })).toThrow(
      'Invalid formula compile budget'
    );
    expect(() => createTranslator({ ...options(), policyVersion: 0 })).toThrow(
      'Invalid formula compile budget configuration'
    );
    const settings = options({ sqlBytes: 0 });
    const translator = createTranslator(settings);
    settings.mode = 'observe';
    expect(translator.translateExpression('1').isErr()).toBe(true);
  });

  it('reuses certified rendering without exhausting the budget on identical reads', () => {
    const source = 'LEN({Input}) + LEN({Input})';
    const baseline = createTranslator(options());
    const expression = baseline.translateExpression(source)._unsafeUnwrap();
    const expected = baseline.renderSql(expression)._unsafeUnwrap();
    const max = baseline.getCompileBudgetMetrics(expression)!.fragmentBytes;
    const translator = createTranslator(options({ fragmentBytes: max }));
    const compiled = translator.translateExpression(source)._unsafeUnwrap();
    for (let index = 0; index < 20; index++)
      expect(translator.renderSql(compiled)._unsafeUnwrap()).toBe(expected);
  });

  it('bounds actual visits even when identical outputs share graph nodes', () => {
    const source = 'LEN({Input}) + LEN({Input})';
    const baseline = createTranslator(options());
    const expression = baseline.translateExpression(source)._unsafeUnwrap();
    const metrics = baseline.getCompileBudgetMetrics(expression)!;
    const shared = createTranslator(options({ uniqueNodes: metrics.uniqueNodes }));
    expect(shared.translateExpressions([source, source]).isOk()).toBe(true);
    const tight = createTranslator(options({ visitedNodes: metrics.visitedNodes }));
    expect(tight.translateExpressions([source, source])._unsafeUnwrapErr().code).toBe(
      'validation.limit.formula_compile_nodes_max'
    );
  });

  it('includes the cached referenced subtree when a later output adds another reference level', () => {
    const translator = createTranslator(options({ referenceDepth: 1 }));
    expect(translator.translateExpressions(['{Shared}', '{Parent}'])._unsafeUnwrapErr().code).toBe(
      'validation.limit.formula_reference_depth_max'
    );
    expect(
      createTranslator(options({ referenceDepth: 2 }))
        .translateExpressions(['{Shared}', '{Parent}'])
        .isOk()
    ).toBe(true);
    expect(
      createTranslator(options({ referenceDepth: 1 }))
        .resolveFieldById('Parent')
        ._unsafeUnwrapErr().code
    ).toBe('validation.limit.formula_reference_depth_max');
  });

  it('keeps the generated channels unchanged with a wide policy and rejects tight compiler budgets', () => {
    const source = 'IF(TRUE, LEN({Input}), VALUE("invalid"))';
    const baseline = createTranslator().translateExpression(source)._unsafeUnwrap();
    const accepted = createTranslator(options()).translateExpression(source)._unsafeUnwrap();
    expect({ ...accepted, field: undefined }).toEqual({ ...baseline, field: undefined });
    for (const [metric, code] of [
      ['uniqueNodes', 'validation.limit.formula_compile_nodes_max'],
      ['bindings', 'validation.limit.formula_bindings_max'],
      ['fragmentBytes', 'validation.limit.formula_compile_bytes_max'],
      ['sqlBytes', 'validation.limit.formula_sql_bytes_max'],
    ] as const) {
      expect(
        createTranslator(options({ [metric]: 0 }))
          .translateExpression(source)
          ._unsafeUnwrapErr().code
      ).toBe(code);
    }
  });

  it('reports each exceeded metric once in observe mode without rejecting the original compilation', () => {
    const violations: FormulaBudgetViolation[] = [];
    const translator = createTranslator(
      options(
        { visitedNodes: 0, uniqueNodes: 0, fragmentBytes: 0, sqlBytes: 0 },
        'observe',
        (violation) => violations.push(violation)
      )
    );
    const expressions = translator
      .translateExpressions(['LEN({Input})', 'LEN({Input})'])
      ._unsafeUnwrap();
    translator
      .renderExpressions(expressions, (raw, budget) =>
        budget.join(
          raw.map((expr) => expr.valueSql),
          ', '
        )
      )
      ._unsafeUnwrap();
    expect(violations.map(({ metric }) => metric).sort()).toEqual([
      'fragmentBytes',
      'sqlBytes',
      'uniqueNodes',
      'visitedNodes',
    ]);
  });

  it('measures Unicode output as UTF-8 bytes at the complete-statement boundary', () => {
    const sql = "SELECT '😀汉字'";
    const bytes = Buffer.byteLength(sql, 'utf8');
    expect(checkFormulaSqlBudget(sql, options({ sqlBytes: bytes }))._unsafeUnwrap()).toBe(sql);
    expect(
      checkFormulaSqlBudget(sql, options({ sqlBytes: bytes - 1 }))._unsafeUnwrapErr().details
    ).toEqual({ metric: 'sqlBytes', attempted: bytes, max: bytes - 1, policyVersion: 1 });
    const templateBudget = new FormulaCompileBudget(options({ fragmentBytes: 4 }));
    expect(templateBudget.sql`${'\ud83d'}${'\ude00'}`).toBe('😀');
    const joinBudget = new FormulaCompileBudget(options({ fragmentBytes: 4 }));
    expect(joinBudget.join(['\ud83d', '\ude00'], '')).toBe('😀');
  });

  it('closes every public channel before returning and returns host composition failures as Results', () => {
    expect(
      createTranslator(options({ sqlBytes: 1 }))
        .translateExpressions(['1', 'LEN({Input})'])
        .isErr()
    ).toBe(true);
    const translator = createTranslator(options());
    const expressions = translator.translateExpressions(['1', '2'])._unsafeUnwrap();
    expect(expressions.map((expr) => Object.freeze({ ...expr }).valueSql)).toEqual(['1', '2']);
    const result = translator.renderExpressions(expressions, (raw, budget) =>
      budget.join(Array(300000).fill(raw[0].valueSql), ', ')
    );
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_sql_bytes_max');
  });

  it('does not relabel an unknown resolver or host callback exception as a budget failure', () => {
    const translator = createTranslator(options());
    const expression = translator.translateExpression('1')._unsafeUnwrap();
    const failure = new Error('host failure');
    expect(() =>
      translator.renderExpression(expression, () => {
        throw failure;
      })
    ).toThrow(failure);
  });
});
