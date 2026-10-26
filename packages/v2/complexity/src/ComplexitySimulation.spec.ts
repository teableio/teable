import { describe, expect, it } from 'vitest';

import { buildSchemaComplexityStatistics, simulateSchemaComplexity } from './ComplexitySimulation';


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

const field = (
  id: string,
  tableId: string,
  options: { computed?: boolean; conditional?: boolean } = {}
) => ({
  id,
  tableId,
  type: options.computed ? 'formula' : 'text',
  isComputed: options.computed ?? false,
  ...(options.conditional ? { conditional: true } : {}),
});

const edge = (fromFieldId: string, toFieldId: string, fromTableId: string, toTableId: string) => ({
  fromFieldId,
  toFieldId,
  fromTableId,
  toTableId,
  kind: 'same_record' as const,
});

describe('simulateSchemaComplexity', () => {
  it('uses a 1M-row conditional target with selectivity 0.0003', () => {
    const profile = simulateSchemaComplexity({
      schema: {
        fields: [
          field('fldA', 'tblA'),
          field('fldCond', 'tblB'),
          { ...field('fldB', 'tblB', { computed: true, conditional: true }) },
        ],
        edges: [
          {
            ...edge('fldA', 'fldB', 'tblA', 'tblB'),
            kind: 'cross_record',
            linkFieldId: 'fldLink',
            conditional: true,
            conditionFieldIds: ['fldCond'],
          },
        ],
      },
      operation: {
        kind: 'update',
        tableId: 'tblA',
        changedFieldIds: ['fldA'],
        beforeImage: 'available',
      },
      assumptions: {
        rowCounts: { tblA: 1, tblB: 1_000_000 },
        seedRecordCount: 1,
        linkFanout: { fldLink: { mean: 1 } },
        conditionalTargetHitFractions: {
          fldB: { fraction: 0.0003, sourceDirtyCount: 1, includesBeforeImage: true },
        },
      },
    });

    expect(profile.dataEstimate.status).toBe('partial');
    expect(profile.dataEstimate.paths[0]?.mode).toBe('conditionalFiltered');
    expect(profile.dataEstimate.paths[0]?.scan).toEqual(range(1_000_000, 1_000_000, 1_000_000));
    expect(profile.dataEstimate.paths[0]?.dirty).toEqual(range(300, 300, 300));
    expect(profile.dataEstimate.totals.pathWork.dirty).toEqual(range(300, 300, 300));
    expect(profile.dataEstimate.totals.distinct.dirty).toEqual(range(300, 300, 300));
  });

  it('uses a 200k order fanout for one customer', () => {
    const profile = simulateSchemaComplexity({
      schema: {
        fields: [
          field('fldCustomer', 'tblCustomer'),
          field('fldOrders', 'tblOrder', { computed: true }),
        ],
        edges: [
          {
            ...edge('fldCustomer', 'fldOrders', 'tblCustomer', 'tblOrder'),
            kind: 'cross_record',
            linkFieldId: 'fldCustomerOrders',
          },
        ],
      },
      operation: { kind: 'update', tableId: 'tblCustomer', changedFieldIds: ['fldCustomer'] },
      assumptions: {
        rowCounts: { tblCustomer: 1, tblOrder: 1_000_000 },
        seedRecordCount: 1,
        linkFanout: { fldCustomerOrders: { mean: 200_000, p50: 200_000, p95: 200_000 } },
      },
    });

    expect(profile.dataEstimate.paths[0]?.mode).toBe('linkTraversal');
    expect(profile.dataEstimate.paths[0]?.dirty).toEqual(range(200_000, 200_000, 200_000));
  });

  it('simulates a 10k-row paste through a same-table formula chain', () => {
    const profile = simulateSchemaComplexity({
      schema: {
        fields: [
          field('fldA', 'tblA'),
          field('fldB', 'tblA', { computed: true }),
          field('fldC', 'tblA', { computed: true }),
        ],
        edges: [edge('fldA', 'fldB', 'tblA', 'tblA'), edge('fldB', 'fldC', 'tblA', 'tblA')],
      },
      operation: {
        kind: 'paste',
        pasteMode: 'insert',
        tableId: 'tblA',
        changedFieldIds: ['fldA'],
      },
      assumptions: { rowCounts: { tblA: 100_000 }, seedRecordCount: 10_000 },
    });

    expect(profile.dataEstimate.status).toBe('partial');
    expect(profile.dataEstimate.totals.pathWork.dirty).toEqual(range(20_000, 20_000, 20_000));
    expect(profile.dataEstimate.totals.distinct.dirty).toEqual(range(20_000, 20_000, 20_000));
    expect(profile.dataEstimate.totals.distinct.scan).toEqual(range(10_000, 10_000, 10_000));
  });

  it('estimates a seed-only same-record path without row counts', () => {
    const profile = simulateSchemaComplexity({
      schema: {
        fields: [field('fldA', 'tblA'), field('fldB', 'tblA', { computed: true })],
        edges: [edge('fldA', 'fldB', 'tblA', 'tblA')],
      },
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
      assumptions: { seedRecordCount: 3 },
    });

    expect(profile.dataEstimate.status).toBe('partial');
    expect(profile.dataEstimate.confidence).toBe('low');
    expect(profile.dataEstimate.totals.pathWork.dirty).toEqual(range(3, 3, 3));
    expect(profile.dataEstimate.paths[0]?.warnings).toContain('missing-target-row-count:tblA');
  });

  it('marks a caller mean-only fanout partial, never catalog-complete', () => {
    const { statistics } = buildSchemaComplexityStatistics(
      [field('fldCustomer', 'tblCustomer'), field('fldOrders', 'tblOrder', { computed: true })],
      [
        {
          ...edge('fldCustomer', 'fldOrders', 'tblCustomer', 'tblOrder'),
          kind: 'cross_record',
          linkFieldId: 'fldCustomerOrders',
        },
      ],
      { kind: 'update', tableId: 'tblCustomer', changedFieldIds: ['fldCustomer'] },
      { seedRecordCount: 1, linkFanout: { fldCustomerOrders: { mean: 200_000 } } }
    );
    const link = statistics?.links.find(
      (candidate) => candidate.linkFieldId === 'fldCustomerOrders'
    );

    expect(link).toMatchObject({
      method: 'caller',
      completeness: 'partial',
      confidence: 'low',
    });
    expect(link?.warnings).toContain('fanout-percentiles-missing');
  });

  it('marks a full caller fanout complete, never catalog', () => {
    const { statistics } = buildSchemaComplexityStatistics(
      [field('fldCustomer', 'tblCustomer'), field('fldOrders', 'tblOrder', { computed: true })],
      [
        {
          ...edge('fldCustomer', 'fldOrders', 'tblCustomer', 'tblOrder'),
          kind: 'cross_record',
          linkFieldId: 'fldCustomerOrders',
        },
      ],
      { kind: 'update', tableId: 'tblCustomer', changedFieldIds: ['fldCustomer'] },
      {
        seedRecordCount: 1,
        linkFanout: {
          fldCustomerOrders: { mean: 200_000, p50: 180_000, p95: 250_000, max: 300_000 },
        },
      }
    );
    const link = statistics?.links.find(
      (candidate) => candidate.linkFieldId === 'fldCustomerOrders'
    );

    expect(link).toMatchObject({
      method: 'caller',
      completeness: 'complete',
      confidence: 'medium',
    });
    expect(link?.warnings).toBeUndefined();
  });

  it('stays not-estimated with null ranges when no assumptions are supplied', () => {
    const profile = simulateSchemaComplexity({
      schema: {
        fields: [field('fldA', 'tblA'), field('fldB', 'tblA', { computed: true })],
        edges: [edge('fldA', 'fldB', 'tblA', 'tblA')],
      },
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
    });

    expect(profile.dataEstimate.status).toBe('not-estimated');
    expect(profile.dataEstimate.totals.pathWork.dirty).toEqual(range(null, null, null));
    expect(profile.dataEstimate.totals.distinct.dirty).toEqual(range(null, null, null));
  });

  it('allows explicit zero rows without inventing a missing value', () => {
    const profile = simulateSchemaComplexity({
      schema: {
        fields: [field('fldA', 'tblA'), field('fldB', 'tblA', { computed: true })],
        edges: [edge('fldA', 'fldB', 'tblA', 'tblA')],
      },
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
      assumptions: { rowCounts: { tblA: 0 }, seedRecordCount: 0 },
    });

    expect(profile.dataEstimate.status).toBe('partial');
    expect(profile.dataEstimate.totals.pathWork.dirty).toEqual(range(0, 0, 0));
    expect(profile.dataEstimate.totals.distinct.dirty).toEqual(range(0, 0, 0));
  });
});
