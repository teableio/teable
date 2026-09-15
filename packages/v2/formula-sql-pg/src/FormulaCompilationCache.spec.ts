import { BaseId, FieldId, FieldName, Table, TableName } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { formulaParseCache, parseFormulaExpression } from './FormulaParseCache';
import { FormulaSqlPgBindings } from './FormulaSqlPgBindings';
import { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy, PgLegacyTypeValidationStrategy } from './strategies';

const createTranslator = (
  alias = 't',
  timeZone = 'UTC',
  numeric = false,
  typeValidationStrategy = new Pg16TypeValidationStrategy()
) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Compile cache')._unsafeUnwrap());
  const fieldBuilder = builder.field();
  (numeric ? fieldBuilder.number() : fieldBuilder.singleLineText())
    .withId(FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(FieldName.create('Input')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  return new FormulaSqlPgTranslator({
    table: builder.build()._unsafeUnwrap(),
    tableAlias: alias,
    timeZone,
    typeValidationStrategy,
    resolveFieldSql: (field) =>
      ok(
        makeExpr(
          `"${alias}"."input"`,
          numeric ? 'number' : 'string',
          false,
          undefined,
          undefined,
          field
        )
      ),
  });
};

const formulas = [
  'SUM(ARRAY_COMPACT(TEXTSPLIT({Input}, ",")))',
  'LEN({Input}) + LEN({Input})',
  'DATETIME_FORMAT(NOW(), "YYYY-MM-DD HH:mm")',
  'IF(LEN({Input}), UPPER({Input}), "empty")',
];

let benchmarkSequence = 0;
const compileProjection = (translator: FormulaSqlPgTranslator, eager = false) => {
  if (process.env.FORMULA_COMPILER_WORKLOAD === 'single-json') {
    // More than the LRU capacity, while retaining identical formula semantics.
    const suffix =
      process.env.FORMULA_COMPILER_CACHE_MODE === 'cold'
        ? ' '.repeat((benchmarkSequence++ % 512) + 1)
        : '';
    const expression = translator
      .translateExpression('TEXTSPLIT({Input}, ",")' + suffix)
      ._unsafeUnwrap();
    // Existing single-output consumers inspect channels before composing a guard.
    const channels = { ...expression };
    return translator.renderExpression(expression, (raw) =>
      channels.errorConditionSql
        ? `CASE WHEN ${raw.errorConditionSql} THEN NULL ELSE ${raw.valueSql} END`
        : raw.valueSql
    );
  }
  const expressions = translator.translateExpressions(formulas)._unsafeUnwrap();
  if (eager) {
    // The pre-change translator rendered every output channel before the host
    // projection rendered the raw channels again. Force that exact extra work.
    for (const expression of expressions) {
      void expression.valueSql;
      void expression.displayValueSql;
      void expression.errorConditionSql;
      void expression.errorMessageSql;
    }
  }
  return translator.renderExpressions(expressions, (raw) =>
    raw.map((expression, index) => `${expression.valueSql} AS "f${index}"`).join(', ')
  );
};

describe('formula compilation reuse', () => {
  it('renders the host projection once without rendering unused output channels', () => {
    const translator = createTranslator();
    const render = vi.spyOn(FormulaSqlPgBindings.prototype, 'render');
    const expressions = translator.translateExpressions(formulas)._unsafeUnwrap();
    expect(render).not.toHaveBeenCalled();
    translator.renderExpressions(expressions, (raw) => raw[0].valueSql);
    expect(render).toHaveBeenCalledTimes(1);
    const first = expressions[0].valueSql;
    expect(render).toHaveBeenCalledTimes(2);
    expect(expressions[0].valueSql).toBe(first);
    expect(render).toHaveBeenCalledTimes(2);
    expect({ ...expressions[0] }.valueSql).toBe(first);
  });

  it('keeps singleton channels as plain eager data properties', () => {
    const expression = createTranslator()
      .translateExpression('TEXTSPLIT({Input}, ",")')
      ._unsafeUnwrap();
    const descriptor = Object.getOwnPropertyDescriptor(expression, 'valueSql');
    expect(descriptor?.get).toBeUndefined();
    expect(descriptor?.writable).toBe(true);
    expect(Object.freeze(expression).valueSql).toContain('string_to_array');
  });

  it('keeps output properties assignable before and after lazy rendering', () => {
    const expression = createTranslator()
      .translateExpressions(['1 + 2', '3 + 4'])
      ._unsafeUnwrap()[0];
    expression.valueSql = 'replacement';
    expect(expression.valueSql).toBe('replacement');
    void expression.errorConditionSql;
    expression.errorConditionSql = 'TRUE';
    expect(expression.errorConditionSql).toBe('TRUE');
  });

  it('resolves fields and types anew after a cache hit', () => {
    const text = createTranslator('first').translateExpression('{Input}')._unsafeUnwrap();
    const numeric = createTranslator('second', 'UTC', true)
      .translateExpression('{Input}')
      ._unsafeUnwrap();
    expect(text.valueSql).toContain('"first"');
    expect(numeric.valueSql).toContain('"second"');
    expect(numeric.valueSql).not.toContain('"first"');
    expect(text.valueType).toBe('string');
    expect(numeric.valueType).toBe('number');
  });

  it('keeps PostgreSQL validation strategies isolated after a syntax cache hit', () => {
    const source = 'VALUE({Input})';
    const native = createTranslator().translateExpression(source)._unsafeUnwrap();
    const legacy = createTranslator('t', 'UTC', false, new PgLegacyTypeValidationStrategy())
      .translateExpression(source)
      ._unsafeUnwrap();
    expect(native.valueSql).toContain('pg_input_is_valid');
    expect(legacy.valueSql).toContain('teable_try_cast_valid');
    expect(legacy.valueSql).not.toContain('pg_input_is_valid');
  });

  it.each(['UTC', 'Asia/Shanghai', 'America/New_York'])(
    'matches uncached eager compilation in %s, including all error/display channels',
    (zone) => {
      const cached = createTranslator('cached', zone);
      const actual = cached
        .translateExpressions(formulas)
        ._unsafeUnwrap()
        .map((expr) => ({ ...expr, field: undefined }));
      const projection = compileProjection(cached);
      const parse = vi.spyOn(formulaParseCache, 'parse').mockImplementation(parseFormulaExpression);
      try {
        const baseline = createTranslator('cached', zone);
        expect(
          baseline
            .translateExpressions(formulas)
            ._unsafeUnwrap()
            .map((expr) => ({ ...expr, field: undefined }))
        ).toEqual(actual);
        expect(compileProjection(baseline, true)).toBe(projection);
      } finally {
        parse.mockRestore();
      }
    }
  );
});

// Opt-in benchmark: CI correctness is deterministic and has no timing threshold.
// FORMULA_COMPILER_BENCH=1 pnpm --filter @teable/v2-formula-sql-pg exec vitest run src/FormulaCompilationCache.spec.ts
it.skipIf(process.env.FORMULA_COMPILER_BENCH !== '1')(
  'reports controlled before/after compiler timings',
  () => {
    const iterations = Number(process.env.FORMULA_COMPILER_ITERATIONS ?? 1000);
    const samples: { baselineMs: number; optimizedMs: number }[] = [];
    const run = (baseline: boolean) => {
      const parse = baseline
        ? vi.spyOn(formulaParseCache, 'parse').mockImplementation(parseFormulaExpression)
        : undefined;
      benchmarkSequence = 0;
      const translators = Array.from({ length: iterations }, () => createTranslator());
      try {
        const start = performance.now();
        for (const translator of translators) compileProjection(translator, baseline);
        return performance.now() - start;
      } finally {
        parse?.mockRestore();
      }
    };
    run(true);
    run(false);
    for (let sample = 0; sample < 7; sample++) {
      // Alternate order to reduce warmup/GC ordering bias.
      const first = run(sample % 2 === 0);
      const second = run(sample % 2 !== 0);
      samples.push(
        sample % 2 === 0
          ? { baselineMs: first, optimizedMs: second }
          : { baselineMs: second, optimizedMs: first }
      );
    }
    console.info(
      JSON.stringify({
        benchmark: 'compile-four-output-projection',
        workload: process.env.FORMULA_COMPILER_WORKLOAD ?? 'multi',
        cacheMode: process.env.FORMULA_COMPILER_CACHE_MODE ?? 'warm',
        iterations,
        samples,
      })
    );
  }
);
