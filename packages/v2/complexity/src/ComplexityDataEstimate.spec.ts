import { describe, expect, it } from 'vitest';

import {
  buildSchemaComplexityProfile,
  type SchemaComplexityProfileInput,
} from './ComplexityProfile';
import {
  estimateOperationData,
  type ConditionalTargetHitStatistics,
  type DataStatisticsSnapshot,
  type LinkFanoutStatistics,
  type TableDataStatistics,
} from './ComplexityDataEstimate';


const range = (
  expected: number | null,
  lower: number | null,
  upper: number | null
): { status: 'estimated' | 'bounded' | 'unknown'; expected: number | null; lower: number | null; upper: number | null } => ({
  status: expected !== null ? 'estimated' : lower !== null || upper !== null ? 'bounded' : 'unknown',
  expected,
  lower,
  upper,
});

const field = (id: string, tableId = 'tblA') => ({
  id,
  tableId,
  type: 'text',
  isComputed: false,
});
const computed = (id: string, tableId = 'tblA') => ({
  ...field(id, tableId),
  type: 'formula',
  isComputed: true,
});
const edge = (
  fromFieldId: string,
  toFieldId: string,
  fromTableId = 'tblA',
  toTableId = 'tblA'
) => ({
  fromFieldId,
  toFieldId,
  fromTableId,
  toTableId,
  kind: 'same_record' as const,
});

const tableStats = (input: {
  tableId: string;
  rowCount: number | null;
  links?: ReadonlyArray<LinkFanoutStatistics>;
  fields?: TableDataStatistics['fields'];
}): TableDataStatistics => ({
  tableId: input.tableId,
  rowCount: input.rowCount,
  avgRowBytes: null,
  lastAnalyzeAt: '2026-10-24T00:00:00.000Z',
  fields: input.fields ?? [],
  links: input.links ?? [],
});

const snapshot = (input: {
  tableId: string;
  rowCount: number | null;
  relatedTables?: ReadonlyArray<TableDataStatistics>;
  links?: ReadonlyArray<LinkFanoutStatistics>;
  conditionals?: TableDataStatistics['conditionals'];
  changeRate?: number | null;
}): DataStatisticsSnapshot => ({
  ...tableStats(input),
  conditionals: input.conditionals,
  relatedTables: input.relatedTables,
  capturedAt: '2026-10-24T00:00:00.000Z',
  source: 'caller',
  completeness: 'complete',
  confidence: 'high',
  changeRate: input.changeRate ?? null,
});

const buildOperation = (input: SchemaComplexityProfileInput) => {
  const profile = buildSchemaComplexityProfile({ ...input, completeness: 'complete' });
  if (!profile.operation) throw new Error('operation missing');
  return profile.operation;
};

const linkFanout = (overrides: Partial<LinkFanoutStatistics> = {}): LinkFanoutStatistics => ({
  fromTableId: 'tblA',
  toTableId: 'tblB',
  linkFieldId: null,
  mean: 3,
  p50: 2,
  p95: 5,
  max: 10,
  method: 'catalog',
  source: 'caller',
  completeness: 'complete',
  confidence: 'high',
  ...overrides,
});
const conditionalHit = (
  overrides: Partial<ConditionalTargetHitStatistics> = {}
): ConditionalTargetHitStatistics => ({
  fromTableId: 'tblA',
  toTableId: 'tblA',
  fromFieldId: 'fldA',
  toFieldId: 'fldB',
  linkFieldId: null,
  fraction: 0.25,
  sourceDirtyCount: 10,
  includesBeforeImage: true,
  source: 'caller',
  completeness: 'complete',
  confidence: 'high',
  ...overrides,
});

describe('estimateOperationData', () => {
  it('carries Customer dirty rows through Orders into Items instead of reusing the seed', () => {
    const operation = buildOperation({
      fields: [field('customer', 'Customer'), computed('order', 'Orders'), computed('item', 'Items')],
      edges: [
        { ...edge('customer', 'order', 'Customer', 'Orders'), kind: 'cross_record', linkFieldId: 'orders' },
        { ...edge('order', 'item', 'Orders', 'Items'), kind: 'cross_record', linkFieldId: 'items' },
      ],
      operation: { kind: 'update', tableId: 'Customer', changedFieldIds: ['customer'] },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({
        tableId: 'Customer', rowCount: 100,
        links: [linkFanout({ fromTableId: 'Customer', toTableId: 'Orders', linkFieldId: 'orders', mean: 10, p50: 10, p95: 10 })],
        relatedTables: [
          tableStats({ tableId: 'Orders', rowCount: 1000, links: [linkFanout({ fromTableId: 'Orders', toTableId: 'Items', linkFieldId: 'items', mean: 5, p50: 5, p95: 5 })] }),
          tableStats({ tableId: 'Items', rowCount: 10000 }),
        ],
      }),
      seedRecordCount: 1,
    });

    expect(estimate.paths.map((path) => path.dirty.expected)).toEqual([10, 50]);
    expect(estimate.paths.map((path) => path.scan.expected)).toEqual([1, 10]);
    expect(estimate.totals.pathWork.dirty.expected).toBe(60);
  });

  it('estimates same-record work from the seed count', () => {
    const operation = buildOperation({
      fields: [field('fldA'), computed('fldB')],
      edges: [edge('fldA', 'fldB')],
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({ tableId: 'tblA', rowCount: 100 }),
      seedRecordCount: 10,
    });

    expect(estimate.status).toBe('partial');
    expect(estimate.paths).toHaveLength(1);
    expect(estimate.paths[0]).toMatchObject({
      mode: 'sameRecord',
      scan: range(10, 10, 10),
      dirty: range(10, 10, 10),
      estimatedWrites: range(null, null, null),
    });
    expect(estimate.totals.pathWork.dirty).toEqual(range(10, 10, 10));
    expect(estimate.totals.distinct.dirty).toEqual(range(10, 10, 10));
  });

  it('uses link mean/p50/p95 and caps to target rows', () => {
    const operation = buildOperation({
      fields: [field('fldA'), computed('fldB', 'tblB')],
      edges: [{ ...edge('fldA', 'fldB', 'tblA', 'tblB'), kind: 'cross_record', linkFieldId: 'lnk' }],
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({
        tableId: 'tblA',
        rowCount: 100,
        relatedTables: [tableStats({ tableId: 'tblB', rowCount: 40 })],
        links: [linkFanout({ linkFieldId: 'lnk', p95: 20 })],
      }),
      seedRecordCount: 10,
    });

    expect(estimate.paths[0]?.mode).toBe('linkTraversal');
    expect(estimate.paths[0]?.dirty).toEqual(range(30, 20, 40));
    expect(estimate.paths[0]?.scan).toEqual(range(10, 10, 10));
  });

  it('matches reverse-direction link fanout from a reader snapshot', () => {
    const operation = buildOperation({
      fields: [field('fldA', 'tblA'), computed('fldB', 'tblB')],
      edges: [{ ...edge('fldB', 'fldA', 'tblB', 'tblA'), kind: 'cross_record', linkFieldId: 'lnk' }],
      operation: { kind: 'update', tableId: 'tblB', changedFieldIds: ['fldB'] },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({
        tableId: 'tblB',
        rowCount: 25,
        relatedTables: [tableStats({ tableId: 'tblA', rowCount: 100 })],
        links: [linkFanout({ fromTableId: 'tblB', toTableId: 'tblA', linkFieldId: 'lnk', mean: 4, p50: 4, p95: 4 })],
      }),
      seedRecordCount: 10,
    });

    expect(estimate.paths[0]?.dirty).toEqual(range(40, 40, 40));
  });

  it('uses exact linkFieldId when one table pair has multiple links', () => {
    const operation = buildOperation({
      fields: [field('fldA', 'tblA'), computed('fldB', 'tblB')],
      edges: [{ ...edge('fldA', 'fldB', 'tblA', 'tblB'), kind: 'cross_record', linkFieldId: 'second' }],
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({
        tableId: 'tblA',
        rowCount: 10,
        relatedTables: [tableStats({ tableId: 'tblB', rowCount: 1000 })],
        links: [
          linkFanout({ linkFieldId: 'first', mean: 10, p50: 10, p95: 10 }),
          linkFanout({ linkFieldId: 'second', mean: 2, p50: 2, p95: 2 }),
        ],
      }),
      seedRecordCount: 1,
    });
    expect(estimate.paths[0]?.dirty.expected).toBe(2);
  });

  it('keeps a cross-record path without linkFieldId unknown', () => {
    const operation = buildOperation({
      fields: [field('fldA', 'tblA'), computed('fldB', 'tblB')],
      edges: [{ ...edge('fldA', 'fldB', 'tblA', 'tblB'), kind: 'cross_record' }],
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({
        tableId: 'tblA',
        rowCount: 10,
        relatedTables: [tableStats({ tableId: 'tblB', rowCount: 1000 })],
        links: [linkFanout({ linkFieldId: 'guessed', mean: 5, p50: 5, p95: 5 })],
      }),
      seedRecordCount: 1,
    });
    expect(estimate.paths[0]?.dirty.status).toBe('unknown');
    expect(estimate.paths[0]?.warnings).toContain('missing-link-field');
  });

  it('keeps link dirty null when fanout or target rows are unknown', () => {
    const operation = buildOperation({
      fields: [field('fldA', 'tblA'), computed('fldB', 'tblB')],
      edges: [{ ...edge('fldB', 'fldA', 'tblB', 'tblA'), kind: 'cross_record', linkFieldId: 'lnk' }],
      operation: { kind: 'update', tableId: 'tblB', changedFieldIds: ['fldB'] },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({
        tableId: 'tblB',
        rowCount: 25,
        links: [
          linkFanout({ fromTableId: 'tblB', toTableId: 'tblA', mean: null, p50: null, p95: null }),
        ],
      }),
      seedRecordCount: 10,
    });

    expect(estimate.paths[0]?.dirty).toEqual(range(null, null, null));
    expect(estimate.paths[0]?.warnings).toContain('missing-link-fanout');
    expect(estimate.paths[0]?.warnings).toContain('missing-target-row-count:tblA');
  });

  it('keeps conditional dirty null when selectivity is unknown', () => {
    const operation = buildOperation({
      fields: [field('fldA'), field('fldCond'), { ...computed('fldB'), conditional: true }],
      edges: [
        {
          ...edge('fldA', 'fldB'),
          conditional: true,
          conditionFieldIds: ['fldCond'],
        },
      ],
      operation: {
        kind: 'update',
        tableId: 'tblA',
        changedFieldIds: ['fldA'],
        beforeImage: 'available',
      },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({
        tableId: 'tblA',
        rowCount: 100,
        conditionals: [
          conditionalHit({ fraction: null, sourceDirtyCount: null, includesBeforeImage: true }),
        ],
      }),
      seedRecordCount: 10,
    });

    expect(estimate.paths[0]?.mode).toBe('conditionalFiltered');
    expect(estimate.paths[0]?.scan).toEqual(range(100, 100, 100));
    expect(estimate.paths[0]?.dirty).toEqual({
      status: 'bounded',
      expected: null,
      lower: 0,
      upper: 100,
    });
    expect(estimate.paths[0]?.warnings).toContain('missing-conditional-target-hit-fraction');
    const known = estimateOperationData({
      operation,
      statistics: snapshot({
        tableId: 'tblA',
        rowCount: 100,
        conditionals: [
          conditionalHit({ fraction: 0.25, sourceDirtyCount: 10, includesBeforeImage: true }),
        ],
      }),
      seedRecordCount: 10,
    });
    expect(known.paths[0]?.dirty).toEqual({
      status: 'estimated',
      expected: 25,
      lower: 25,
      upper: 25,
    });
  });

  it('groups conditional scan by the target table, not the source table', () => {
    const operation = buildOperation({
      fields: [field('fldA', 'tblA'), { ...computed('fldB', 'tblB'), conditional: true }],
      edges: [
        {
          ...edge('fldA', 'fldB', 'tblA', 'tblB'),
          kind: 'cross_record',
          conditional: true,
          conditionFieldIds: ['fldCond'],
        },
      ],
      operation: {
        kind: 'update',
        tableId: 'tblA',
        changedFieldIds: ['fldA'],
        beforeImage: 'available',
      },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({
        tableId: 'tblA',
        rowCount: 1,
        relatedTables: [tableStats({ tableId: 'tblB', rowCount: 100 })],
        conditionals: [
          conditionalHit({
            toTableId: 'tblB',
            fraction: 0.5,
            sourceDirtyCount: 1,
            includesBeforeImage: true,
          }),
        ],
      }),
      seedRecordCount: 1,
    });

    expect(estimate.paths[0]?.scanTableId).toBe('tblB');
    expect(estimate.paths[0]?.scan).toEqual(range(100, 100, 100));
    expect(estimate.totals.distinct.scan).toEqual(range(100, 100, 100));
    expect(estimate.totals.distinct.dirty).toEqual(range(50, 50, 50));
  });

  it('uses target rows for allTargetRecords and backfill', () => {
    const operation = buildOperation({
      fields: [field('fldA'), computed('fldB', 'tblB')],
      edges: [],
      operation: {
        kind: 'update',
        tableId: 'tblA',
        changedFieldIds: ['fldA'],
        plan: {
          steps: [{ tableId: 'tblB', fieldIds: ['fldB'], level: 1 }],
          paths: [
            {
              fromFieldId: 'fldA',
              toFieldId: 'fldB',
              fromTableId: 'tblA',
              toTableId: 'tblB',
              mode: 'allTargetRecords',
              origin: 'dependency',
            },
          ],
          beforeImage: 'available',
        },
      },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({
        tableId: 'tblA',
        rowCount: 10,
        relatedTables: [tableStats({ tableId: 'tblB', rowCount: 40 })],
      }),
      seedRecordCount: 1,
    });

    expect(estimate.paths[0]?.mode).toBe('allTargetRecords');
    expect(estimate.paths[0]?.scan).toEqual(range(40, 40, 40));
    expect(estimate.paths[0]?.dirty).toEqual(range(40, 40, 40));
  });

  it('uses the field table for synthetic self-backfill', () => {
    const operation = buildOperation({
      fields: [field('fldA'), field('fldCond'), { ...computed('fldB'), conditional: true }],
      edges: [
        {
          ...edge('fldA', 'fldB'),
          conditional: true,
          conditionFieldIds: ['fldCond'],
        },
      ],
      operation: {
        kind: 'field-change',
        fieldChange: 'update',
        tableId: 'tblA',
        changedFieldIds: ['fldB'],
        beforeImage: 'available',
      },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({ tableId: 'tblA', rowCount: 100 }),
      seedRecordCount: 1,
    });
    const selfBackfill = estimate.paths.find((path) => path.origin === 'field-backfill');

    expect(selfBackfill).toMatchObject({
      mode: 'backfill',
      scan: range(100, 100, 100),
      dirty: range(100, 100, 100),
    });
  });

  it('derives estimatedWrites only when changeRate exists', () => {
    const operation = buildOperation({
      fields: [field('fldA'), computed('fldB')],
      edges: [edge('fldA', 'fldB')],
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
    });
    const withoutRate = estimateOperationData({
      operation,
      statistics: snapshot({ tableId: 'tblA', rowCount: 100 }),
      seedRecordCount: 10,
    });
    const withRate = estimateOperationData({
      operation,
      statistics: snapshot({ tableId: 'tblA', rowCount: 100, changeRate: 0.5 }),
      seedRecordCount: 10,
    });

    expect(withoutRate.totals.pathWork.estimatedWrites.expected).toBeNull();
    expect(withRate.totals.pathWork.estimatedWrites).toEqual(range(5, 5, 5));
    expect(withRate.totals.distinct.estimatedWrites).toEqual(range(5, 5, 5));
  });

  it('does not double-count multiple paths over the same target table', () => {
    const operation = buildOperation({
      fields: [field('fldA'), field('fldB'), computed('fldC')],
      edges: [edge('fldA', 'fldC'), edge('fldB', 'fldC')],
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA', 'fldB'] },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({ tableId: 'tblA', rowCount: 100 }),
      seedRecordCount: 10,
    });

    expect(estimate.paths).toHaveLength(2);
    expect(estimate.totals.pathWork.scan).toEqual(range(20, 20, 20));
    expect(estimate.totals.pathWork.dirty).toEqual(range(20, 20, 20));
    expect(estimate.totals.distinct.scan).toEqual(range(10, 10, 10));
    expect(estimate.totals.distinct.dirty).toEqual(range(10, 10, 10));
  });

  it('does not cap pathWork scan by target row count', () => {
    const operation = buildOperation({
      fields: [field('fldA'), computed('fldB')],
      edges: [edge('fldA', 'fldB')],
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
    });
    const estimate = estimateOperationData({
      operation,
      statistics: snapshot({ tableId: 'tblA', rowCount: 1 }),
      seedRecordCount: 10,
    });

    expect(estimate.totals.pathWork.scan).toEqual(range(10, 10, 10));
    expect(estimate.totals.pathWork.dirty).toEqual(range(1, 1, 1));
    expect(estimate.totals.distinct.scan).toEqual(range(1, 1, 1));
    expect(estimate.totals.distinct.dirty).toEqual(range(1, 1, 1));
  });

  it('returns not-estimated without statistics or seed count', () => {
    const operation = buildOperation({
      fields: [field('fldA'), computed('fldB')],
      edges: [edge('fldA', 'fldB')],
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
    });

    expect(
      estimateOperationData({ operation, statistics: null, seedRecordCount: 10 })
    ).toMatchObject({
      status: 'not-estimated',
      totals: {
        pathWork: {
          scan: range(null, null, null),
          dirty: range(null, null, null),
        },
        distinct: {
          scan: range(null, null, null),
          dirty: range(null, null, null),
        },
      },
    });
    expect(
      estimateOperationData({ operation, statistics: snapshot({ tableId: 'tblA', rowCount: 1 }) })
    ).toMatchObject({ status: 'not-estimated', seedRecordCount: null });
  });
});
