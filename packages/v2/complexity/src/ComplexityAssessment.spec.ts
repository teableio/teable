import { describe, expect, it } from 'vitest';

import { buildComplexityAssessment } from './ComplexityAssessment';
import {
  buildSchemaComplexityProfile,
  type SchemaComplexityEdge,
  type SchemaComplexityField,
  type SchemaComplexityProfile,
} from './ComplexityProfile';
import { simulateSchemaComplexity } from './ComplexitySimulation';

const field = (
  id: string,
  tableId: string,
  options: { computed?: boolean } = {}
): SchemaComplexityField => ({
  id,
  tableId,
  type: options.computed ? 'formula' : 'text',
  isComputed: options.computed ?? false,
});

const sameRecordEdge = (
  fromFieldId: string,
  toFieldId: string,
  tableId: string
): SchemaComplexityEdge => ({
  fromFieldId,
  toFieldId,
  fromTableId: tableId,
  toTableId: tableId,
  kind: 'same_record',
});

const crossRecordEdge = (
  fromFieldId: string,
  toFieldId: string,
  fromTableId: string,
  toTableId: string,
  linkFieldId: string
): SchemaComplexityEdge => ({
  fromFieldId,
  toFieldId,
  fromTableId,
  toTableId,
  kind: 'cross_record',
  linkFieldId,
});

const sameRecordSchema = {
  fields: [field('fldA', 'tblA'), field('fldB', 'tblA', { computed: true })],
  edges: [sameRecordEdge('fldA', 'fldB', 'tblA')],
};

const linkSchema = {
  fields: [field('fldA', 'tblA'), field('fldB', 'tblB', { computed: true })],
  edges: [crossRecordEdge('fldA', 'fldB', 'tblA', 'tblB', 'lnkAB')],
};

const simulateSameRecord = (rows: number, options: { changeRate?: number } = {}) =>
  simulateSchemaComplexity({
    schema: sameRecordSchema,
    operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
    assumptions: {
      rowCounts: { tblA: rows },
      seedRecordCount: rows,
      ...(options.changeRate === undefined ? {} : { changeRate: options.changeRate }),
    },
    completeness: 'complete',
  });

const simulateLink = (fanout: {
  mean?: number;
  p50?: number;
  p95?: number;
  max?: number;
}) =>
  simulateSchemaComplexity({
    schema: linkSchema,
    operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
    assumptions: {
      rowCounts: { tblA: 1, tblB: 2_000_000 },
      seedRecordCount: 1,
      linkFanout: { lnkAB: fanout },
      changeRate: 1,
    },
    completeness: 'complete',
  });

describe('buildComplexityAssessment workload level', () => {
  it.each([
    { rows: 0, level: 'trivial' },
    { rows: 999, level: 'low' },
    { rows: 1_000, level: 'medium' },
    { rows: 99_999, level: 'medium' },
    { rows: 100_000, level: 'high' },
    { rows: 999_999, level: 'high' },
    { rows: 1_000_000, level: 'critical' },
    { rows: 100_000_000, level: 'critical' },
  ] as const)('maps $rows rows to $level', ({ rows, level }) => {
    const assessment = buildComplexityAssessment(simulateSameRecord(rows, { changeRate: 1 }));

    expect(assessment.level).toBe(level);
    expect(assessment.workload.level).toBe(level);
    expect(assessment.workload.status).toBe('estimated');
    expect(assessment.workload.basis).toBe('max-scan-dirty');
    expect(assessment.workload.rows).toMatchObject({
      status: 'estimated',
      expected: rows,
      lower: rows,
      upper: rows,
    });
    expect(assessment.score).not.toBeNull();
  });

  it('treats a known 1M upper bound as critical when expected is unknown', () => {
    const assessment = buildComplexityAssessment(simulateLink({ p95: 1_000_000 }));

    expect(assessment.workload.status).toBe('bounded');
    expect(assessment.workload.rows.expected).toBeNull();
    expect(assessment.workload.rows.upper).toBe(1_000_000);
    expect(assessment.level).toBe('critical');
    expect(assessment.workload.warnings).toContain('workload-level-from-upper-bound');
    expect(assessment.score).toBeNull();
  });

  it('treats a 500k..2M range as critical from its upper bound', () => {
    const assessment = buildComplexityAssessment(
      simulateLink({ p50: 500_000, p95: 2_000_000 })
    );

    expect(assessment.workload.rows).toMatchObject({
      status: 'bounded',
      expected: null,
      lower: 500_000,
      upper: 2_000_000,
    });
    expect(assessment.level).toBe('critical');
  });

  it('forces critical from a 1M lower bound when expected and upper are unknown', () => {
    const assessment = buildComplexityAssessment(simulateLink({ p50: 1_000_000 }));

    expect(assessment.workload.rows).toMatchObject({
      status: 'bounded',
      expected: null,
      lower: 1_000_000,
      upper: null,
    });
    expect(assessment.level).toBe('critical');
    expect(assessment.workload.warnings).toContain('workload-level-from-lower-bound');
  });

  it('keeps critical when expected is low but the upper bound reaches 1M', () => {
    const assessment = buildComplexityAssessment(
      simulateLink({ mean: 1_000, p50: 1_000, p95: 2_000_000 })
    );

    expect(assessment.workload.rows.expected).toBe(1_000);
    expect(assessment.workload.rows.upper).toBe(2_000_000);
    expect(assessment.level).toBe('critical');
    expect(assessment.workload.warnings).toContain('workload-level-from-upper-bound');
  });

  it('is critical when expected is 1M', () => {
    const assessment = buildComplexityAssessment(
      simulateLink({ mean: 1_000_000, p50: 1_000_000, p95: 1_000_000 })
    );

    expect(assessment.workload.rows.status).toBe('estimated');
    expect(assessment.level).toBe('critical');
  });

  it('reports unknown level and null score when every workload value is unknown', () => {
    const profile = buildSchemaComplexityProfile(sameRecordSchema);
    const assessment = buildComplexityAssessment(profile);

    expect(assessment.level).toBe('unknown');
    expect(assessment.workload).toMatchObject({
      status: 'unknown',
      level: 'unknown',
      basis: 'max-scan-dirty',
      rows: { status: 'unknown', expected: null, lower: null, upper: null },
    });
    expect(assessment.workload.warnings).toContain('workload-unknown');
    expect(assessment.components.dataWork).toBeNull();
    expect(assessment.score).toBeNull();
    expect(assessment.confidence).toBe('low');
    expect(assessment.reasonCodes).toContain('data-work-not-estimated');
    expect(assessment.headline).toContain('unknown');
    expect(assessment.headline).toContain('not-estimated');
  });
});

describe('buildComplexityAssessment data work', () => {
  it('keeps delete, field delete and convert out of low/trivial without data work', () => {
    const fields = [field('fldA', 'tblA'), field('fldB', 'tblA', { computed: true })];
    const edges = [sameRecordEdge('fldA', 'fldB', 'tblA')];
    const profiles = [
      buildSchemaComplexityProfile({
        fields,
        edges,
        operation: { kind: 'delete', tableId: 'tblA', changedFieldIds: ['fldA'] },
        completeness: 'complete',
      }),
      buildSchemaComplexityProfile({
        fields,
        edges,
        operation: {
          kind: 'field-change',
          tableId: 'tblA',
          changedFieldIds: ['fldB'],
          fieldChange: 'delete',
        },
        completeness: 'complete',
      }),
      buildSchemaComplexityProfile({
        fields,
        edges,
        operation: {
          kind: 'field-change',
          tableId: 'tblA',
          changedFieldIds: ['fldB'],
          fieldChange: 'convert',
        },
        completeness: 'complete',
      }),
    ];
    for (const profile of profiles) {
      const assessment = buildComplexityAssessment(profile);
      if (profile.operation?.fieldChange === 'delete') {
        expect(assessment.reasonCodes).toContain('field-delete-work-unknown');
      }
      expect(assessment.level).toBe('unknown');
      expect(assessment.workload.status).toBe('unknown');
      expect(assessment.level).not.toBe('low');
      expect(assessment.level).not.toBe('trivial');
      expect(assessment.score).toBeNull();
    }
  });

  it('never scores unknown writes as zero', () => {
    const assessment = buildComplexityAssessment(simulateSameRecord(1_000));

    expect(assessment.workload.rows.upper).toBe(1_000);
    expect(assessment.level).toBe('medium');
    expect(assessment.components.dataWork).toBeNull();
    expect(assessment.score).toBeNull();
    expect(assessment.confidence).toBe('low');
    expect(assessment.reasonCodes).toContain('data-work-writes-unknown');
  });

  it('scores data work for a partial estimate only when all needed dimensions are known', () => {
    const simulated = simulateSameRecord(1_000, { changeRate: 1 });
    const partial: SchemaComplexityProfile = {
      ...simulated,
      dataEstimate: { ...simulated.dataEstimate, status: 'partial' },
    };
    const assessment = buildComplexityAssessment(partial);

    expect(assessment.components.dataWork).not.toBeNull();
    expect(assessment.score).not.toBeNull();
    expect(assessment.level).toBe('medium');
    expect(assessment.confidence).toBe('low');
    expect(assessment.reasonCodes).toContain('data-estimate-partial');
    expect(assessment.headline).toContain('data partial');
  });
});

describe('buildComplexityAssessment risk and determinism', () => {
  it('deduplicates risk codes contributed by both structure and operation', () => {
    const profile = buildSchemaComplexityProfile({
      ...sameRecordSchema,
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
      completeness: 'partial',
    });
    const assessment = buildComplexityAssessment(profile);

    expect(assessment.reasonCodes.filter((code) => code === 'schema-partial')).toHaveLength(1);
    expect(new Set(assessment.reasonCodes).size).toBe(assessment.reasonCodes.length);
  });

  it('is byte-stable under JSON serialization', () => {
    const profile = simulateLink({ mean: 1_000, p50: 1_000, p95: 2_000_000 });

    expect(JSON.stringify(buildComplexityAssessment(profile))).toBe(
      JSON.stringify(buildComplexityAssessment(profile))
    );
  });
  it('keeps path/mode breakdown and distinct workload separate for a diamond', () => {
    const profile = simulateSchemaComplexity({
      schema: {
        fields: [field('fldA', 'tblA'), field('fldB', 'tblA'), field('fldC', 'tblA', { computed: true })],
        edges: [
          sameRecordEdge('fldA', 'fldC', 'tblA'),
          sameRecordEdge('fldB', 'fldC', 'tblA'),
        ],
      },
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA', 'fldB'] },
      assumptions: { rowCounts: { tblA: 100 }, seedRecordCount: 10, changeRate: 1 },
      completeness: 'complete',
    });
    const assessment = buildComplexityAssessment(profile);
    expect(assessment.workload.rows.expected).toBe(10);
    expect(assessment.breakdown.modes.find((mode) => mode.mode === 'sameRecord')?.pathCount).toBe(2);
    expect(assessment.breakdown.paths).toHaveLength(2);
    expect(assessment.breakdown.paths.every((path) => path.workRows.expected === 10)).toBe(true);
    expect(assessment.breakdown.modes.find((mode) => mode.mode === 'sameRecord')?.workRows.expected).toBe(20);
  });

  it('adds a link mode/path breakdown with shares', () => {
    const assessment = buildComplexityAssessment(
      simulateLink({ mean: 100, p50: 100, p95: 200 })
    );
    const mode = assessment.breakdown.modes.find((entry) => entry.mode === 'linkTraversal')!;
    expect(mode.pathCount).toBe(1);
    expect(mode.share.typicalShare).toBe(1);
    expect(assessment.breakdown.paths[0]).toMatchObject({
      mode: 'linkTraversal',
      linkFieldId: 'lnkAB',
      level: 1,
    });
    expect(assessment.breakdown.paths[0]?.workRows.upper).toBe(200);
  });

  it('returns zero workload and no path entries for a no-dependency manual update', () => {
    const profile = simulateSchemaComplexity({
      schema: { fields: [field('fldA', 'tblA')], edges: [] },
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
      assumptions: { rowCounts: { tblA: 10 }, seedRecordCount: 10, changeRate: 1 },
      completeness: 'complete',
    });
    const assessment = buildComplexityAssessment(profile);
    expect(assessment.level).toBe('trivial');
    expect(assessment.workload.rows).toMatchObject({ expected: 0, lower: 0, upper: 0 });
    expect(assessment.breakdown.paths).toEqual([]);
    expect(assessment.breakdown.modes.every((mode) => mode.pathCount === 0)).toBe(true);
  });

  it('estimates a non-computed 1M-row field convert as critical backfill', () => {
    const profile = simulateSchemaComplexity({
      schema: { fields: [field('fldA', 'tblA')], edges: [] },
      operation: {
        kind: 'field-change',
        tableId: 'tblA',
        changedFieldIds: ['fldA'],
        fieldChange: 'convert',
      },
      assumptions: { rowCounts: { tblA: 1_000_000 }, seedRecordCount: 1, changeRate: 1 },
      completeness: 'complete',
    });
    const assessment = buildComplexityAssessment(profile);
    expect(profile.operation?.schemaPotential.propagationPaths[0]?.mode).toBe('backfill');
    expect(assessment.level).toBe('critical');
    expect(assessment.workload.rows.expected).toBe(1_000_000);
    expect(assessment.level).not.toBe('low');
    expect(assessment.level).not.toBe('trivial');
  });

  it('derives expected rows when lower and upper are the same bounded value', () => {
    const profile = simulateSameRecord(10, { changeRate: 1 });
    const bounded = { status: 'bounded' as const, expected: null, lower: 10, upper: 10 };
    const assessment = buildComplexityAssessment({
      ...profile,
      dataEstimate: profile.dataEstimate
        ? {
            ...profile.dataEstimate,
            totals: {
              ...profile.dataEstimate.totals,
              pathWork: {
                ...profile.dataEstimate.totals.pathWork,
                scan: bounded,
                dirty: bounded,
              },
            },
          }
        : undefined,
    });
    expect(assessment.workload.rows).toMatchObject({
      status: 'estimated',
      expected: 10,
      lower: 10,
      upper: 10,
    });
    expect(assessment.workload.typicalLevel).not.toBe('unknown');
  });

});
