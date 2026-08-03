import { describe, expect, it } from 'vitest';

import { planRecommendedIndexSet, type IndexSetPlannerCandidate } from './indexSetPlanner';

const candidate = (
  input: Partial<IndexSetPlannerCandidate> & Pick<IndexSetPlannerCandidate, 'candidateId'>
): IndexSetPlannerCandidate => ({
  indexKind: 'btree',
  accessPath: 'composite',
  indexStructure: 'BTREE on status, date',
  fields: [
    { fieldId: 'fld_status', fieldDbName: 'status', role: 'filter' },
    { fieldId: 'fld_date', fieldDbName: 'date', role: 'filter' },
  ],
  coveredSourceIds: ['viw_a'],
  coveredQueryKinds: ['filter'],
  coveredShapeHashes: ['shape_a'],
  reasonCodes: ['missing_useful_index'],
  riskLevels: ['high'],
  explainStatus: 'validated',
  explainCostBefore: 100,
  explainCostAfter: 10,
  explainCostDelta: -90,
  explainCostDeltaPct: -90,
  plannerUsedIndex: true,
  ...input,
});

describe('IndexSetPlanner', () => {
  it('keeps one final composite index when candidates use the same field set in different order', () => {
    const result = planRecommendedIndexSet([
      candidate({
        candidateId: 'status_date_shop',
        fields: [
          { fieldId: 'fld_status', fieldDbName: 'status', role: 'filter' },
          { fieldId: 'fld_date', fieldDbName: 'date', role: 'filter' },
          { fieldId: 'fld_shop', fieldDbName: 'shop', role: 'sort' },
        ],
        explainCostBefore: 100,
        explainCostAfter: 20,
        explainCostDelta: -80,
        explainCostDeltaPct: -80,
      }),
      candidate({
        candidateId: 'shop_status_date',
        fields: [
          { fieldId: 'fld_shop', fieldDbName: 'shop', role: 'sort' },
          { fieldId: 'fld_status', fieldDbName: 'status', role: 'filter' },
          { fieldId: 'fld_date', fieldDbName: 'date', role: 'filter' },
        ],
        explainCostBefore: 100,
        explainCostAfter: 5,
        explainCostDelta: -95,
        explainCostDeltaPct: -95,
      }),
    ]);

    expect(result.recommendedIndexSet).toHaveLength(1);
    expect(result.recommendedIndexSet[0]?.candidateId).toBe('shop_status_date');
    expect(result.recommendedIndexSet[0]?.coveredCandidateIds).toEqual([
      'shop_status_date',
      'status_date_shop',
    ]);
    expect(result.rejectedCandidates).toMatchObject([
      {
        candidate: { candidateId: 'status_date_shop' },
        rejectionReason: 'covered_by_better_index_candidate',
        coveredByCandidateId: 'shop_status_date',
      },
    ]);
  });

  it('downgrades a low-value plan improvement to manual investigation', () => {
    const result = planRecommendedIndexSet([
      candidate({
        candidateId: 'low_value',
        explainCostBefore: 2.6,
        explainCostAfter: 2.2,
        explainCostDelta: -0.4,
        explainCostDeltaPct: -15.38,
      }),
    ]);

    expect(result.recommendedIndexSet).toEqual([]);
    expect(result.rejectedCandidates).toMatchObject([
      {
        candidate: { candidateId: 'low_value' },
        nextAction: 'manual_investigation',
        rejectionReason: 'low_absolute_cost_improvement',
      },
    ]);
  });

  it('rejects validated candidates when the planner does not use the index', () => {
    const result = planRecommendedIndexSet([
      candidate({
        candidateId: 'unused_index',
        plannerUsedIndex: false,
        explainCostBefore: 100,
        explainCostAfter: 20,
        explainCostDelta: -80,
        explainCostDeltaPct: -80,
      }),
    ]);

    expect(result.recommendedIndexSet).toEqual([]);
    expect(result.rejectedCandidates).toMatchObject([
      {
        candidate: { candidateId: 'unused_index' },
        nextAction: 'candidate_not_recommended',
        rejectionReason: 'planner_did_not_use_index',
      },
    ]);
  });
});
