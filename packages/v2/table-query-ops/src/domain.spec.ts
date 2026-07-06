import { describe, expect, it } from 'vitest';

import {
  TablePhysicalStats,
  TableQueryIndexInspection,
  TableQueryObservationWindow,
  TableQueryPlanValidation,
  TableQueryRecommendation,
  TableQueryRiskPolicy,
  TableQueryShape,
} from './domain';

const createObservation = () => {
  const shape = TableQueryShape.create({
    queryKind: 'search',
    searchShape: {
      fieldCount: 40,
      allFields: true,
      valueLengthBucket: 'medium',
    },
    fanoutShape: {
      companionRequestCount: 4,
      rowCountRequests: 1,
      aggregationRequests: 2,
      searchIndexRequests: 1,
    },
    executionShape: {
      durationMs: 12_000,
      timedOut: true,
      errorKind: 'timeout',
    },
  })._unsafeUnwrap();

  return TableQueryObservationWindow.create({
    baseId: 'bse_test',
    tableId: 'tbl_test',
    windowStart: new Date('2026-06-01T00:00:00.000Z'),
    windowSizeSeconds: 300,
    shape,
    requestCount: 8,
    slowCount: 5,
    timeoutCount: 3,
    dbErrorCount: 0,
    totalDurationMs: 42_000,
    maxDurationMs: 12_000,
  })._unsafeUnwrap();
};

describe('TableQueryShape', () => {
  it('rejects raw query literals', () => {
    const result = TableQueryShape.create({
      queryKind: 'search',
      searchValue: 'customer-secret',
      executionShape: {
        durationMs: 10,
        timedOut: false,
      },
    });

    expect(result.isErr()).toBe(true);
  });
});

describe('TableQueryRiskPolicy', () => {
  it('raises risk and recommends phase 1 index remediation for slow wide search', () => {
    const observation = createObservation();
    const physicalStats = TablePhysicalStats.create({
      estimatedRows: 100_000,
      totalBytes: 1024,
    })._unsafeUnwrap();
    const indexInspection = TableQueryIndexInspection.create({
      state: 'missing',
      usefulIndexes: [],
      missingIndexCandidates: [
        {
          fieldId: 'fld_name',
          fieldDbName: 'name',
          kind: 'gin_trgm',
          reason: 'Search field can use trigram index',
        },
      ],
      abnormalIndexes: [],
    })._unsafeUnwrap();

    const report = new TableQueryRiskPolicy().evaluate({
      observation,
      physicalStats,
      indexInspection,
    });

    expect(report.isOk()).toBe(true);
    expect(report._unsafeUnwrap().level()).toBe('critical');
    expect(report._unsafeUnwrap().snapshot().remediationCandidates[0]?.kind).toBe(
      'create_search_index'
    );
  });

  it('keeps plan validation evidence in the risk report snapshot', () => {
    const observation = createObservation();
    const physicalStats = TablePhysicalStats.create({
      estimatedRows: 100_000,
      totalBytes: 1024,
    })._unsafeUnwrap();
    const indexInspection = TableQueryIndexInspection.create({
      state: 'missing',
      usefulIndexes: [],
      missingIndexCandidates: [],
      abnormalIndexes: [],
    })._unsafeUnwrap();
    const planValidation = TableQueryPlanValidation.create({
      status: 'validated',
      method: 'hypothetical_index',
      candidateCount: 1,
      totalCostBefore: 100,
      totalCostAfter: 25,
      usesCandidateIndex: true,
    })._unsafeUnwrap();

    const report = new TableQueryRiskPolicy().evaluate({
      observation,
      physicalStats,
      indexInspection,
      planValidation,
    });

    expect(report._unsafeUnwrap().snapshot().planValidation?.status).toBe('validated');
    expect(planValidation.supportsAutoExecution()).toBe(true);
  });

  it('snapshots query risk independently from index recommendations', () => {
    const observation = createObservation();
    const physicalStats = TablePhysicalStats.create({
      estimatedRows: 250_000,
      totalBytes: 2048,
    })._unsafeUnwrap();
    const indexInspection = TableQueryIndexInspection.create({
      state: 'ready',
      usefulIndexes: [],
      missingIndexCandidates: [],
      abnormalIndexes: [],
    })._unsafeUnwrap();

    const report = new TableQueryRiskPolicy().evaluate({
      observation,
      physicalStats,
      indexInspection,
    });
    const snapshot = report._unsafeUnwrap().snapshot();

    expect(snapshot.level).toBe('critical');
    expect(snapshot.reasonCodes).toContain('critical_latency');
    expect(snapshot.observation.shape.searchShape).toMatchObject({
      fieldCount: 40,
      allFields: true,
      valueLengthBucket: 'medium',
    });
    expect(snapshot.physicalStats.estimatedRows).toBe(250_000);
    expect(snapshot.indexInspection.missingIndexCandidates).toEqual([]);
  });
});

describe('TableQueryRiskPolicy advisor matrix', () => {
  const cases = [
    {
      name: 'single equality filter recommends a btree filter index',
      shape: {
        queryKind: 'filter',
        whereShape: {
          conditionCount: 1,
          andDepth: 1,
          orDepth: 0,
          fields: [
            { fieldId: 'fld_status', fieldType: 'singleSelect', operatorFamily: 'equality' },
          ],
        },
        executionShape: { durationMs: 12_000, timedOut: false, resultCountBucket: 'small' },
      },
      indexInspection: {
        state: 'missing',
        usefulIndexes: [],
        missingIndexCandidates: [
          {
            fieldId: 'fld_status',
            fieldDbName: 'status',
            kind: 'btree',
            reason: 'Filter predicate can use btree index',
          },
        ],
        abnormalIndexes: [],
      },
    },
    {
      name: 'single range filter recommends a btree filter index',
      shape: {
        queryKind: 'filter',
        whereShape: {
          conditionCount: 1,
          andDepth: 1,
          orDepth: 0,
          fields: [{ fieldId: 'fld_due', fieldType: 'date', operatorFamily: 'range' }],
        },
        executionShape: { durationMs: 12_000, timedOut: false, resultCountBucket: 'small' },
      },
      indexInspection: {
        state: 'missing',
        usefulIndexes: [],
        missingIndexCandidates: [
          {
            fieldId: 'fld_due',
            fieldDbName: 'due_date',
            kind: 'btree',
            reason: 'Filter predicate can use btree index',
          },
        ],
        abnormalIndexes: [],
      },
    },
    {
      name: 'sort field recommends a btree sort index',
      shape: {
        queryKind: 'sort',
        orderShape: {
          fields: [{ fieldId: 'fld_created', direction: 'desc', source: 'sort' }],
        },
        executionShape: { durationMs: 12_000, timedOut: false, resultCountBucket: 'medium' },
      },
      indexInspection: {
        state: 'missing',
        usefulIndexes: [],
        missingIndexCandidates: [
          {
            fieldId: 'fld_created',
            fieldDbName: 'created_at',
            kind: 'btree',
            reason: 'Sort or group field can use btree index',
          },
        ],
        abnormalIndexes: [],
      },
    },
    {
      name: 'multi-field table access path can recommend one composite btree index',
      shape: {
        queryKind: 'filter',
        whereShape: {
          conditionCount: 2,
          andDepth: 1,
          orDepth: 0,
          fields: [
            { fieldId: 'fld_status', fieldType: 'singleSelect', operatorFamily: 'equality' },
            { fieldId: 'fld_due', fieldType: 'date', operatorFamily: 'range' },
          ],
        },
        executionShape: { durationMs: 12_000, timedOut: false, resultCountBucket: 'small' },
      },
      indexInspection: {
        state: 'missing',
        usefulIndexes: [],
        missingIndexCandidates: [
          {
            fieldId: 'fld_status',
            fieldDbName: 'status',
            fields: [
              {
                fieldId: 'fld_status',
                fieldDbName: 'status',
                role: 'filter',
              },
              {
                fieldId: 'fld_due',
                fieldDbName: 'due_date',
                role: 'filter',
              },
            ],
            kind: 'btree',
            accessPath: 'composite',
            reason: 'Table query shape can use one composite btree index',
          },
        ],
        abnormalIndexes: [],
      },
    },
    {
      name: 'aggregation fanout without conservative index candidate stays manual',
      shape: {
        queryKind: 'aggregation',
        aggregationShape: {
          groupFieldCount: 0,
          metricCount: 3,
          hasFilter: true,
        },
        fanoutShape: {
          companionRequestCount: 4,
          rowCountRequests: 1,
          aggregationRequests: 3,
          searchIndexRequests: 0,
        },
        executionShape: { durationMs: 12_000, timedOut: false, resultCountBucket: 'large' },
      },
      indexInspection: {
        state: 'ready',
        usefulIndexes: [],
        missingIndexCandidates: [],
        abnormalIndexes: [],
      },
    },
  ] as const;

  it.each(cases)('$name', (testCase) => {
    const shape = TableQueryShape.create(testCase.shape)._unsafeUnwrap();
    const observation = TableQueryObservationWindow.create({
      baseId: 'bse_test',
      tableId: 'tbl_test',
      windowStart: new Date('2026-06-01T00:00:00.000Z'),
      windowSizeSeconds: 300,
      shape,
      requestCount: 6,
      slowCount: 6,
      timeoutCount: 0,
      dbErrorCount: 0,
      totalDurationMs: 72_000,
      maxDurationMs: 12_000,
    })._unsafeUnwrap();
    const physicalStats = TablePhysicalStats.create({
      estimatedRows: 100_000,
      totalBytes: 1024,
    })._unsafeUnwrap();
    const indexInspection = TableQueryIndexInspection.create(
      testCase.indexInspection
    )._unsafeUnwrap();

    const report = new TableQueryRiskPolicy()
      .evaluate({
        observation,
        physicalStats,
        indexInspection,
      })
      ._unsafeUnwrap();

    expect({
      reasonCodes: report.snapshot().reasonCodes,
      remediationCandidates: report.snapshot().remediationCandidates,
      riskLevel: report.level(),
      riskScore: report.score(),
    }).toMatchSnapshot(testCase.name);
    expect(report.shouldRecommend()).toBe(true);
  });
});

describe('TableQueryRecommendation', () => {
  it('can be accepted only from open state', () => {
    const observation = createObservation();
    const physicalStats = TablePhysicalStats.create({
      estimatedRows: 1,
      totalBytes: 1,
    })._unsafeUnwrap();
    const indexInspection = TableQueryIndexInspection.create({
      state: 'ready',
      usefulIndexes: [],
      missingIndexCandidates: [],
      abnormalIndexes: [],
    })._unsafeUnwrap();
    const report = new TableQueryRiskPolicy()
      .evaluate({
        observation,
        physicalStats,
        indexInspection,
      })
      ._unsafeUnwrap();
    const recommendation = TableQueryRecommendation.createOpen({
      observation,
      report,
      now: new Date('2026-06-01T00:00:00.000Z'),
    })._unsafeUnwrap();

    const accepted = recommendation.accept(new Date('2026-06-01T00:01:00.000Z'));

    expect(accepted.isOk()).toBe(true);
    expect(accepted._unsafeUnwrap().accept(new Date()).isErr()).toBe(true);
  });
});
