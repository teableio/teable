import { describe, expect, it } from 'vitest';

import {
  addSearchSemanticsBaselineDeltas,
  assertReadySearchVectorExecutionRecommendation,
  assertSearchVectorExecutionCandidate,
  chooseScopedExpressionNextAction,
  selectSubstringSearchProvider,
  type AnalyzeTableSearchVectorResult,
  type TableQuerySearchSemanticsComparison,
  type TableQuerySearchVectorRecommendation,
  type TableQuerySubstringSearchProviderCapability,
} from './searchVector';

describe('assertReadySearchVectorExecutionRecommendation', () => {
  it('accepts the exact ready advisor recommendation', () => {
    const recommendation = makeRecommendation({
      nextAction: 'ready_for_confirmation',
    });
    const result = makeAnalyzeResult(recommendation);

    expect(
      assertReadySearchVectorExecutionRecommendation(result, {
        candidateKey: recommendation.candidateKey,
        generatedColumnName: recommendation.generatedColumnName,
        indexName: recommendation.indexName,
        fields: [
          { fieldId: 'fldA', fieldDbName: 'fld_a' },
          { fieldId: 'fldB', fieldDbName: 'fld_b' },
        ],
      })
    ).toBe(recommendation);
  });

  it('rejects a candidate that still needs plan validation', () => {
    const recommendation = makeRecommendation({
      nextAction: 'needs_plan_validation',
      explainReason: 'hypopg_gin_unsupported',
    });

    expect(() =>
      assertReadySearchVectorExecutionRecommendation(makeAnalyzeResult(recommendation), {
        candidateKey: recommendation.candidateKey,
        generatedColumnName: recommendation.generatedColumnName,
        indexName: recommendation.indexName,
        fields: [
          { fieldId: 'fldA', fieldDbName: 'fld_a' },
          { fieldId: 'fldB', fieldDbName: 'fld_b' },
        ],
      })
    ).toThrow(/not plan-validated/);
  });

  it('allows real-DDL validation mode to accept a current candidate that still needs plan validation', () => {
    const recommendation = makeRecommendation({
      nextAction: 'needs_plan_validation',
      explainReason: 'hypopg_gin_unsupported',
    });

    expect(
      assertSearchVectorExecutionCandidate(makeAnalyzeResult(recommendation), {
        candidateKey: recommendation.candidateKey,
        generatedColumnName: recommendation.generatedColumnName,
        indexName: recommendation.indexName,
        fields: [
          { fieldId: 'fldA', fieldDbName: 'fld_a' },
          { fieldId: 'fldB', fieldDbName: 'fld_b' },
        ],
      })
    ).toBe(recommendation);
  });

  it('rejects hand-built payloads that do not match advisor field coverage', () => {
    const recommendation = makeRecommendation({
      nextAction: 'ready_for_confirmation',
    });

    expect(() =>
      assertReadySearchVectorExecutionRecommendation(makeAnalyzeResult(recommendation), {
        candidateKey: recommendation.candidateKey,
        generatedColumnName: recommendation.generatedColumnName,
        indexName: recommendation.indexName,
        fields: [{ fieldId: 'fldA', fieldDbName: 'fld_a' }],
      })
    ).toThrow(/field ids/);
  });
});

describe('addSearchSemanticsBaselineDeltas', () => {
  it('adds match-count and sample-overlap deltas against the ILIKE baseline', () => {
    const comparisons = addSearchSemanticsBaselineDeltas([
      makeSemanticsComparison({
        strategy: 'ilike',
        matchCount: 100,
        recordIds: ['recA', 'recB'],
      }),
      makeSemanticsComparison({
        strategy: 'bigram',
        matchCount: 40,
        recordIds: ['recA', 'recC'],
      }),
    ]);

    expect(comparisons[1]).toMatchObject({
      matchCountDeltaFromIlike: -60,
      matchCountDeltaPctFromIlike: -60,
      sampleOverlapWithIlike: 1,
      reasonablenessAssessment: {
        reasonCodes: expect.arrayContaining(['substring_result_mismatch']),
      },
    });
  });

  it('marks identical n-gram match counts as compatible with the ILIKE baseline', () => {
    const comparisons = addSearchSemanticsBaselineDeltas([
      makeSemanticsComparison({
        strategy: 'ilike',
        matchCount: 100,
        recordIds: ['recA'],
      }),
      makeSemanticsComparison({
        strategy: 'trigram',
        matchCount: 100,
        recordIds: ['recA'],
      }),
    ]);

    expect(comparisons[1]?.reasonablenessAssessment.reasonCodes).toContain(
      'substring_results_match'
    );
  });
});

describe('chooseScopedExpressionNextAction', () => {
  it.each([
    {
      name: 'accepts a materially cheaper hypothetical expression index',
      evidence: {
        explainStatus: 'validated' as const,
        explainMethod: 'hypothetical_index' as const,
        costBefore: 100,
        costAfter: 10,
        costDeltaPct: -90,
        usesCandidateIndex: true,
      },
      expected: 'ready_for_confirmation',
    },
    {
      name: 'rejects a plan that only used the existing global index',
      evidence: {
        explainStatus: 'validated' as const,
        explainMethod: 'hypothetical_index' as const,
        costBefore: 100,
        costAfter: 10,
        costDeltaPct: -90,
        usesCandidateIndex: false,
      },
      expected: 'candidate_not_recommended',
    },
    {
      name: 'keeps unvalidated GIN candidates pending',
      evidence: {
        explainStatus: 'skipped' as const,
        explainReason: 'global_search_vector_not_ready',
      },
      expected: 'needs_plan_validation',
    },
  ])('$name', ({ evidence, expected }) => {
    expect(chooseScopedExpressionNextAction(evidence)).toBe(expected);
  });
});

describe('selectSubstringSearchProvider', () => {
  it('prefers pg_bigm only when it is already usable', () => {
    expect(
      selectSubstringSearchProvider([
        makeCapability('pg_bigm', { extensionAvailable: true, usable: false }),
        makeCapability('pg_trgm', { usable: true }),
      ])
    ).toBe('pg_trgm');

    expect(
      selectSubstringSearchProvider([
        makeCapability('pg_bigm', { usable: true }),
        makeCapability('pg_trgm', { usable: true }),
      ])
    ).toBe('pg_bigm');
  });
});

const makeAnalyzeResult = (
  recommendation: TableQuerySearchVectorRecommendation
): AnalyzeTableSearchVectorResult => ({
  tableId: recommendation.tableId,
  baseId: recommendation.baseId,
  languageConfig: recommendation.languageConfig,
  searchProbeLengthBucket: 'medium',
  scannedFieldCount: 2,
  coveredFieldCount: 2,
  skippedFieldCount: 0,
  recommendations: [recommendation],
  scopedExpressionRecommendations: [],
  inventory: recommendation.inventory,
  coverageReport: {
    scannedFieldCount: 2,
    coveredFieldCount: 2,
    skippedFieldCount: 0,
    skippedReasons: {},
  },
});

const makeRecommendation = (input: {
  readonly nextAction: TableQuerySearchVectorRecommendation['nextAction'];
  readonly explainReason?: string;
}): TableQuerySearchVectorRecommendation => ({
  candidateKey: 'search_document:tblTest:pg_trgm:1234',
  tableId: 'tblTest',
  baseId: 'bseTest',
  generatedColumnName: '__tqops_search_1234',
  generatedTextColumnName: '__tqops_search_1234',
  indexName: 'idx_tqops_search_tblTest_1234',
  indexKind: 'gin_trgm',
  accessPath: 'generated_text',
  semantics: 'substring',
  provider: 'pg_trgm',
  providerCapability: makeCapability('pg_trgm', { usable: true }),
  providerCapabilities: [
    makeCapability('pg_bigm', { extensionAvailable: true, usable: false }),
    makeCapability('pg_trgm', { usable: true }),
  ],
  operatorClass: 'gin_trgm_ops',
  minimumProbeLength: 3,
  languageConfig: 'simple',
  searchScope: 'all_fields',
  coveredFields: [
    {
      fieldId: 'fldA',
      fieldDbName: 'fld_a',
      fieldType: 'singleLineText',
      valueType: 'string',
      included: true,
    },
    {
      fieldId: 'fldB',
      fieldDbName: 'fld_b',
      fieldType: 'longText',
      valueType: 'string',
      included: true,
    },
  ],
  skippedFields: [],
  estimatedRows: 1000,
  inventory: { state: 'missing', staleReasons: [] },
  planEvidence: {
    explainStatus: 'validated',
    explainMethod: input.nextAction === 'ready_for_confirmation' ? 'hypothetical_index' : 'explain',
    explainReason: input.explainReason ?? 'plan_validated',
    costBefore: 100,
    costAfter: input.nextAction === 'ready_for_confirmation' ? 10 : undefined,
    costDeltaPct: input.nextAction === 'ready_for_confirmation' ? -90 : undefined,
    usesCandidateIndex: input.nextAction === 'ready_for_confirmation',
  },
  nextAction: input.nextAction,
});

const makeCapability = (
  provider: TableQuerySubstringSearchProviderCapability['provider'],
  overrides: Partial<TableQuerySubstringSearchProviderCapability> = {}
): TableQuerySubstringSearchProviderCapability => {
  const usable = overrides.usable ?? false;
  return {
    provider,
    extensionName: provider,
    operatorClass: provider === 'pg_bigm' ? 'gin_bigm_ops' : 'gin_trgm_ops',
    extensionInstalled: usable,
    extensionAvailable: true,
    operatorClassInstalled: usable,
    usable,
    minimumProbeLength: provider === 'pg_bigm' ? 2 : 3,
    ...(!usable ? { reason: 'extension_not_installed' as const } : {}),
    ...overrides,
  };
};

const makeSemanticsComparison = (input: {
  readonly strategy: TableQuerySearchSemanticsComparison['strategy'];
  readonly matchCount: number;
  readonly recordIds: readonly string[];
}): TableQuerySearchSemanticsComparison => ({
  strategy: input.strategy,
  label: input.strategy,
  semantics: input.strategy === 'trigram' ? 'trigram_substring' : 'substring',
  available: true,
  indexSupport: input.strategy === 'ilike' ? 'none' : 'generated_text_gin',
  tokenPreview: [],
  explainStatus: 'validated',
  matchCount: input.matchCount,
  sampleResults: input.recordIds.map((recordId) => ({
    recordId,
    fieldPreviews: [],
  })),
  reasonablenessAssessment: {
    status: 'needs_llm_review',
    reasonCodes: ['fixture'],
    instruction: 'fixture',
  },
});
