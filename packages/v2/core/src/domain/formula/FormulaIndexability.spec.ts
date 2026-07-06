import { describe, expect, it } from 'vitest';

import {
  analyzeFormulaIndexability,
  assertAllFormulaFunctionsHaveIndexabilityDescriptors,
  FunctionName,
  FormulaExpression,
  listFormulaIndexabilityDescriptors,
} from '../../index';

describe('FormulaIndexability', () => {
  const fieldId = `fld${'z'.repeat(16)}`;

  it('declares indexability for every formula function', () => {
    expect(assertAllFormulaFunctionsHaveIndexabilityDescriptors().isOk()).toBe(true);
    expect(
      listFormulaIndexabilityDescriptors()
        .map((item) => item.functionName)
        .sort()
    ).toEqual(Object.values(FunctionName).sort());
    expect(
      listFormulaIndexabilityDescriptors().every(
        (item) =>
          typeof item.expressionIndexability.supported === 'boolean' &&
          item.expressionIndexability.reason.length > 0
      )
    ).toBe(true);
  });

  it('marks volatile time formulas as not auto-indexable', () => {
    const expression = FormulaExpression.create('NOW()')._unsafeUnwrap();
    const analysis = analyzeFormulaIndexability(expression)._unsafeUnwrap();

    expect(analysis.stable).toBe(false);
    expect(analysis.skippedReasons).toContain('non_stable_formula');
  });

  it('recognizes source-field text search formulas', () => {
    const expression = FormulaExpression.create(
      `SEARCH("abc", {fld${'a'.repeat(16)}})`
    )._unsafeUnwrap();
    const analysis = analyzeFormulaIndexability(expression)._unsafeUnwrap();

    expect(analysis.sourceKind).toBe('formula_source');
    expect(analysis.referencedFieldIds).toEqual([`fld${'a'.repeat(16)}`]);
    expect(analysis.operatorFamilies).toContain('text_contains');
    expect(analysis.candidateIndexes).toContain('gin_trgm');
  });

  it('pushes down IF search predicates to the source text field', () => {
    const sourceFieldId = `fld${'b'.repeat(16)}`;
    const expression = FormulaExpression.create(
      `IF(SEARCH("abc", {${sourceFieldId}}), 1, 2)`
    )._unsafeUnwrap();
    const analysis = analyzeFormulaIndexability(expression)._unsafeUnwrap();

    expect(analysis.sourceKind).toBe('formula_source');
    expect(analysis.predicatePushdown).toMatchObject({
      supported: true,
      operatorFamilies: ['text_contains'],
      sourceFunctionNames: ['SEARCH'],
      skippedReasons: [],
    });
    expect(analysis.candidateIndexes).toContain('gin_trgm');
    expect(JSON.stringify(analysis)).not.toContain('abc');
  });

  it('pushes down IF prefix predicates when LEFT participates in equality', () => {
    const sourceFieldId = `fld${'c'.repeat(16)}`;
    const expression = FormulaExpression.create(
      `IF(LEFT({${sourceFieldId}}, 3) = "abc", 1, 2)`
    )._unsafeUnwrap();
    const analysis = analyzeFormulaIndexability(expression)._unsafeUnwrap();

    expect(analysis.sourceKind).toBe('formula_source');
    expect(analysis.predicatePushdown).toMatchObject({
      supported: true,
      operatorFamilies: ['text_prefix', 'equality'],
      sourceFunctionNames: ['LEFT'],
      skippedReasons: [],
    });
  });

  it('marks unsupported IF predicates explicitly', () => {
    const expression = FormulaExpression.create('IF(AND(1, 2), 1, 2)')._unsafeUnwrap();
    const analysis = analyzeFormulaIndexability(expression)._unsafeUnwrap();

    expect(analysis.sourceKind).toBe('formula_result');
    expect(analysis.predicatePushdown).toMatchObject({
      supported: false,
      skippedReasons: ['predicate_pushdown_not_supported'],
    });
    expect(analysis.skippedReasons).toContain('predicate_pushdown_not_supported');
  });

  it.each([
    {
      name: 'text search formula recommends source-field trigram',
      formula: `SEARCH("needle", {${fieldId}})`,
      expected: {
        sourceKind: 'formula_source',
        operatorFamilies: ['text_contains'],
        candidateIndexes: ['gin_trgm', 'btree'],
        skippedReasons: [],
        predicatePushdown: undefined,
      },
    },
    {
      name: 'IF search predicate recommends source-field trigram with pushdown evidence',
      formula: `IF(SEARCH("needle", {${fieldId}}), 1, 2)`,
      expected: {
        sourceKind: 'formula_source',
        operatorFamilies: ['formula_result', 'text_contains'],
        candidateIndexes: ['btree', 'gin_trgm'],
        skippedReasons: [],
        predicatePushdown: {
          supported: true,
          operatorFamilies: ['text_contains'],
          sourceFunctionNames: ['SEARCH'],
          skippedReasons: [],
        },
      },
    },
    {
      name: 'LEFT formula keeps source prefix advice and expression btree candidate',
      formula: `LEFT({${fieldId}}, 3)`,
      expected: {
        sourceKind: 'formula_source',
        operatorFamilies: ['text_prefix'],
        candidateIndexes: ['btree', 'btree_text_pattern'],
        skippedReasons: [],
        predicatePushdown: undefined,
      },
    },
    {
      name: 'IF prefix predicate recommends source-field prefix/btree candidates',
      formula: `IF(LEFT({${fieldId}}, 3) = "abc", 1, 2)`,
      expected: {
        sourceKind: 'formula_source',
        operatorFamilies: ['formula_result', 'text_prefix', 'equality'],
        candidateIndexes: ['btree', 'btree_text_pattern'],
        skippedReasons: [],
        predicatePushdown: {
          supported: true,
          operatorFamilies: ['text_prefix', 'equality'],
          sourceFunctionNames: ['LEFT'],
          skippedReasons: [],
        },
      },
    },
    {
      name: 'stable expression formula recommends expression-index candidates only',
      formula: `LOWER({${fieldId}})`,
      expected: {
        sourceKind: 'formula_expression',
        operatorFamilies: ['equality', 'text_prefix'],
        candidateIndexes: ['btree', 'btree_text_pattern'],
        skippedReasons: [],
        predicatePushdown: undefined,
      },
    },
    {
      name: 'LEN formula recommends expression btree candidate',
      formula: `LEN({${fieldId}})`,
      expected: {
        sourceKind: 'formula_expression',
        operatorFamilies: ['equality', 'range'],
        candidateIndexes: ['btree'],
        skippedReasons: [],
        predicatePushdown: undefined,
      },
    },
    {
      name: 'unsupported IF predicate recommends formula-result/manual path with explicit reason',
      formula: 'IF(AND(1, 2), 1, 2)',
      expected: {
        sourceKind: 'formula_result',
        operatorFamilies: ['formula_result'],
        candidateIndexes: ['btree'],
        skippedReasons: ['predicate_pushdown_not_supported'],
        predicatePushdown: {
          supported: false,
          operatorFamilies: [],
          sourceFunctionNames: [],
          skippedReasons: ['predicate_pushdown_not_supported'],
        },
      },
    },
    {
      name: 'volatile formula does not recommend executable indexes',
      formula: 'NOW()',
      expected: {
        sourceKind: 'formula_result',
        operatorFamilies: [],
        candidateIndexes: [],
        skippedReasons: ['non_stable_formula'],
        predicatePushdown: undefined,
      },
    },
  ])('$name', ({ formula, expected }) => {
    const analysis = analyzeFormulaIndexability(
      FormulaExpression.create(formula)._unsafeUnwrap()
    )._unsafeUnwrap();

    expect({
      sourceKind: analysis.sourceKind,
      operatorFamilies: analysis.operatorFamilies,
      candidateIndexes: analysis.candidateIndexes,
      skippedReasons: analysis.skippedReasons,
      predicatePushdown: analysis.predicatePushdown,
    }).toEqual(expected);
    expect(JSON.stringify(analysis)).not.toContain('needle');
    expect(JSON.stringify(analysis)).not.toContain('abc');
  });

  it('uses the formula visitor to reject nested non-stable expression indexes', () => {
    const analysis = analyzeFormulaIndexability(
      FormulaExpression.create(`LEFT(CONCATENATE({${fieldId}}, NOW()), 3)`)._unsafeUnwrap()
    )._unsafeUnwrap();

    expect(analysis.expressionIndexable).toBe(false);
    expect(analysis.expressionIndexSkippedReasons).toContain('non_stable_formula');
  });
});
