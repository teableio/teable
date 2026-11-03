import { describe, expect, it } from 'vitest';

import {
  OPERATION_PREVIEW_CAPABILITIES_PATH,
  OPERATION_PREVIEW_PATH,
  operationPreviewCapabilitiesSchema,
  operationPreviewInputSchema,
  operationPreviewSchema,
  previewEffectKindSchema,
  previewMeasureSchema,
  previewOperationSchema,
  previewOperationValues,
} from './operationPreview';

const basePreview = {
  operation: 'table.delete',
  outcome: 'ready',
  effects: [],
  blockers: [],
  warnings: [],
  coverage: { known: ['target-table'], unknown: [] },
  complexity: null,
  authorization: 'checked',
  observedAt: '2026-10-27T10:00:00.000Z',
  consistency: 'best-effort',
  requestDigest: `sha256:${'a'.repeat(64)}`,
  implementation: {
    plannerVersion: 'table-delete-v1',
    executionPath: 'DeleteTableCommand/TableDeletionPreparationService',
  },
} as const;

const exact = { basis: 'exact', value: 3, unit: 'rows' } as const;

const complexity = {
  policyVersion: 'v2-complexity-policy-2',
  level: 'medium',
  score: 42,
  headline: 'Bounded propagation workload',
  workload: {
    status: 'bounded',
    rows: { status: 'bounded', expected: 20, lower: 10, upper: 40 },
    typicalLevel: 'low',
    worstCaseLevel: 'high',
    level: 'high',
    basis: 'max-scan-dirty',
    warnings: ['Catalog estimate is stale'],
  },
  breakdown: {
    shareBasis: 'path-work',
    modes: [
      {
        mode: 'sameRecord',
        pathCount: 1,
        scan: { status: 'estimated', expected: 20, lower: 10, upper: 40 },
        dirty: { status: 'estimated', expected: 10, lower: 5, upper: 20 },
        estimatedWrites: { status: 'estimated', expected: 10, lower: 5, upper: 20 },
        workRows: { status: 'estimated', expected: 30, lower: 15, upper: 60 },
        share: { typicalShare: 1, worstCaseShare: 1, warnings: [] },
      },
    ],
    paths: [
      {
        mode: 'sameRecord',
        fromFieldId: 'fldSource',
        toFieldId: 'fldTarget',
        fromTableId: 'tblSource',
        toTableId: 'tblSource',
        linkFieldId: null,
        level: 1,
        beforeImage: 'not-required',
        alternativeGroup: null,
        certainty: 'structural',
        scan: { status: 'estimated', expected: 20, lower: 10, upper: 40 },
        dirty: { status: 'estimated', expected: 10, lower: 5, upper: 20 },
        estimatedWrites: { status: 'estimated', expected: 10, lower: 5, upper: 20 },
        workRows: { status: 'estimated', expected: 30, lower: 15, upper: 60 },
        share: { typicalShare: 1, worstCaseShare: 1, warnings: [] },
      },
    ],
  },
  components: { structural: 20, dataWork: 10, risk: 12 },
  reasonCodes: ['bounded-propagation'],
  recommendations: ['Preview before writing'],
  confidence: 'medium',
} as const;

describe('operation preview HTTP contract', () => {
  it('keeps operation-specific input opaque and accepts unknown operation codes for registry errors', () => {
    const input = { raw: { tableId: 'tblA' } };
    const parsed = operationPreviewInputSchema.parse({
      operation: 'future.operation',
      input,
      options: { detail: 'full', includeComplexity: true, maxItems: 25 },
    });

    expect(parsed).toEqual({
      operation: 'future.operation',
      input,
      options: { detail: 'full', includeComplexity: true, maxItems: 25 },
    });
    expect(operationPreviewInputSchema.safeParse({ operation: 'table.delete' }).success).toBe(
      false
    );
    expect(
      operationPreviewInputSchema.safeParse({
        operation: 'table.delete',
        input: {},
        options: { maxItems: 0 },
      }).success
    ).toBe(false);
    expect(operationPreviewInputSchema.safeParse({ operation: '', input: {} }).success).toBe(false);
  });

  it('matches the canonical preview operation vocabulary', () => {
    expect(previewOperationSchema.options).toEqual(previewOperationValues);
  });

  it.each([
    { basis: 'exact', value: 3, unit: 'rows' },
    { basis: 'estimate', value: 8, unit: 'rows', source: 'catalog-statistics' },
    {
      basis: 'range',
      lower: null,
      expected: 12,
      upper: 30,
      unit: 'rows',
      source: 'planner-projection',
    },
    { basis: 'unknown', unit: 'rows', reason: 'Selection runs during execution' },
  ])('accepts the $basis measure variant', (measure) => {
    expect(previewMeasureSchema.parse(measure)).toEqual(measure);
  });

  it.each(previewEffectKindSchema.options)('accepts the %s effect variant', (kind) => {
    const parsed = operationPreviewSchema.parse({
      ...basePreview,
      effects: [
        {
          code: `effect.${kind}`,
          kind,
          summary: 'Projected consequence',
          resource: {
            visibility: 'authorized',
            kind: 'table',
            id: 'tblA',
            name: 'Orders',
          },
          relatedResources: [
            {
              visibility: 'redacted',
              kind: 'field',
              quantity: exact,
              reason: 'Not visible to this actor',
            },
          ],
          measures: { affected: exact },
        },
      ],
    });

    expect(parsed.effects[0]?.kind).toBe(kind);
  });

  it('accepts blockers, warnings, redaction, and the rich complexity assessment', () => {
    const parsed = operationPreviewSchema.parse({
      ...basePreview,
      outcome: 'incomplete',
      blockers: [{ code: 'permission.denied', message: 'Write is not permitted' }],
      warnings: [
        {
          code: 'preview.redacted',
          resource: {
            visibility: 'redacted',
            kind: 'field',
            quantity: { basis: 'unknown', unit: 'fields', reason: 'Authorization scope' },
            reason: 'Resource identity is inaccessible',
          },
        },
      ],
      coverage: { known: ['target'], unknown: ['external-hooks'] },
      complexity,
      consistency: 'snapshot',
    });

    expect(parsed.complexity?.workload.rows).toEqual({
      status: 'bounded',
      expected: 20,
      lower: 10,
      upper: 40,
    });
    expect(parsed.warnings[0]?.resource?.visibility).toBe('redacted');
  });

  it('accepts registry-derived capability metadata without operation-specific input schemas', () => {
    expect(
      operationPreviewCapabilitiesSchema.parse([
        {
          operation: 'base.duplicate',
          canonicalWriteRoute: 'POST /base/duplicate',
          supportLevel: 'partial',
          requiredPermissionScope: 'target base|create; source base|update',
          detailLevels: ['summary', 'full'],
          limitations: ['Quota evidence may remain unknown'],
        },
      ])
    ).toHaveLength(1);
  });

  it('exports the canonical operation routes', () => {
    expect(OPERATION_PREVIEW_PATH).toBe('/operations/preview');
    expect(OPERATION_PREVIEW_CAPABILITIES_PATH).toBe('/operations/preview/capabilities');
  });
});
