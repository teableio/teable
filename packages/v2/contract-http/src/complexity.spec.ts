import { describe, expect, it } from 'vitest';

import {
  COMPLEXITY_ASSESS_PATH,
  complexityAssessInputSchema,
  complexityAssessMatrixInputSchema,
  complexityAssessResultSchema,
} from './complexity';

const schema = {
  fields: [{ id: 'fldA', tableId: 'tblA', type: 'number', isComputed: false }],
  edges: [],
};

describe('complexityAssessInputSchema', () => {
  it('accepts a tableId reference', () => {
    const parsed = complexityAssessInputSchema.parse({ tableId: 'tblA' });
    expect(parsed.tableId).toBe('tblA');
  });

  it('defaults assess includeCatalogStats to false and accepts explicit opt-in', () => {
    expect(complexityAssessInputSchema.parse({ tableId: 'tblA' }).includeCatalogStats).toBe(false);
    expect(
      complexityAssessInputSchema.parse({ tableId: 'tblA', includeCatalogStats: true })
        .includeCatalogStats
    ).toBe(true);
  });

  it('accepts a raw schema with operation and assumptions', () => {
    const parsed = complexityAssessInputSchema.parse({
      schema,
      operation: {
        kind: 'update',
        tableId: 'tblA',
        changedFieldIds: ['fldA'],
        beforeImage: 'available',
      },
      assumptions: {
        rowCounts: { tblA: 1_000_000 },
        seedRecordCount: 10,
        linkFanout: { fldLink: { mean: 20, p50: 12, p95: 40, max: 90 } },
        conditionalSelectivity: { fldLink: 0.0003 },
        avgInputRows: { fldRollup: 20 },
        changeRate: 0.5,
        capturedAt: '2026-01-01T00:00:00.000Z',
      },
      completeness: 'partial',
      focusTableId: 'tblA',
      maxTraversalDepth: 4,
    });

    expect(parsed.schema?.fields).toHaveLength(1);
    expect(parsed.operation?.kind).toBe('update');
    expect(parsed.assumptions?.linkFanout?.fldLink?.p95).toBe(40);
  });

  it('rejects tableId and schema together', () => {
    const result = complexityAssessInputSchema.safeParse({ tableId: 'tblA', schema });
    expect(result.success).toBe(false);
  });

  it('rejects when neither tableId nor schema is given', () => {
    const result = complexityAssessInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('uses the expected route path', () => {
    expect(COMPLEXITY_ASSESS_PATH).toBe('/complexity/assess');
  });
});

describe('complexityAssessResultSchema', () => {
  const profile = {
    version: 1,
    basis: 'schema-only',
    scope: { focusTableId: 'tblA' },
    structural: { fieldCount: 1 },
    formulas: [],
    operation: null,
    evidence: { completeness: 'partial' },
    warnings: [],
  };

  it('wraps the profile with a policy assessment', () => {
    const parsed = complexityAssessResultSchema.parse({
      profile: { ...profile, dataEstimate: { status: 'estimated', totals: {} } },
      assessment: {
        policyVersion: 'v2-complexity-policy-2',
        level: 'medium',
        score: 42,
        workload: {
          status: 'estimated',
          rows: { status: 'estimated', expected: 1, lower: 1, upper: 1 },
          typicalLevel: 'medium',
          worstCaseLevel: 'medium',
          level: 'medium',
          basis: 'max-scan-dirty',
          warnings: [],
        },
        headline: 'Two-level chain with a conditional fanout',
        breakdown: { shareBasis: 'path-work', modes: [], paths: [] },
        components: { structural: 30, dataWork: null, risk: 12 },
        reasonCodes: ['conditional-all-target-possible', 'missing-conditional-selectivity'],
        recommendations: ['Narrow the conditional filter'],
        confidence: 'low',
      },
    });

    expect(parsed.profile.dataEstimate).toEqual({ status: 'estimated', totals: {} });
    expect(parsed.assessment.level).toBe('medium');
    expect(parsed.assessment.reasonCodes).toHaveLength(2);
  });

  it('accepts a profile without runtimeCost', () => {
    const parsed = complexityAssessResultSchema.parse({
      profile,
      assessment: {
        policyVersion: 'v2-complexity-policy-2',
        level: 'low',
        score: 5,
        workload: {
          status: 'estimated',
          rows: { status: 'estimated', expected: 1, lower: 1, upper: 1 },
          typicalLevel: 'medium',
          worstCaseLevel: 'medium',
          level: 'medium',
          basis: 'max-scan-dirty',
          warnings: [],
        },
        headline: 'Small',
        breakdown: { shareBasis: 'path-work', modes: [], paths: [] },
        components: { structural: 5, dataWork: null, risk: 0 },
        reasonCodes: [],
        recommendations: [],
        confidence: 'high',
      },
    });

    expect(parsed.profile).not.toHaveProperty('runtimeCost');
  });

  it('rejects a score outside the policy range', () => {
    const result = complexityAssessResultSchema.safeParse({
      profile,
      assessment: {
        policyVersion: 'v2-complexity-policy-2',
        level: 'critical',
        score: 101,
        workload: {
          status: 'estimated',
          rows: { status: 'estimated', expected: 1, lower: 1, upper: 1 },
          typicalLevel: 'medium',
          worstCaseLevel: 'medium',
          level: 'medium',
          basis: 'max-scan-dirty',
          warnings: [],
        },
        headline: 'invalid',
        breakdown: { shareBasis: 'path-work', modes: [], paths: [] },
        components: { structural: 1, dataWork: 1, risk: 1 },
        reasonCodes: [],
        recommendations: [],
        confidence: 'high',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects the retired very_high level and unknown policy version', () => {
    const base = {
      profile,
      assessment: {
        policyVersion: 'v2-complexity-policy-2',
        level: 'very_high',
        score: 90,
        workload: {
          status: 'estimated',
          rows: { status: 'estimated', expected: 1, lower: 1, upper: 1 },
          typicalLevel: 'medium',
          worstCaseLevel: 'medium',
          level: 'medium',
          basis: 'max-scan-dirty',
          warnings: [],
        },
        headline: 'x',
        breakdown: { shareBasis: 'path-work', modes: [], paths: [] },
        components: { structural: 1, dataWork: null, risk: 1 },
        reasonCodes: [],
        recommendations: [],
        confidence: 'high',
      },
    };
    expect(complexityAssessResultSchema.safeParse(base).success).toBe(false);
    expect(
      complexityAssessResultSchema.safeParse({
        ...base,
        assessment: { ...base.assessment, level: 'critical', policyVersion: 'v1' },
      }).success
    ).toBe(false);
  });
  it('accepts wide matrix field lists up to the protection cap', () => {
    const fieldIds = Array.from({ length: 201 }, (_, index) => `fld${index}`);
    const parsed = complexityAssessMatrixInputSchema.parse({ tableId: 'tblA', fieldIds });
    expect(parsed.fieldIds).toHaveLength(201);
  });

});
