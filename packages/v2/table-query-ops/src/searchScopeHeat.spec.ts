import { describe, expect, it } from 'vitest';

import { TableQueryObservationWindow, TableQueryShape } from './domain';
import { SearchScopeHeatPolicy } from './searchScopeHeat';

const observation = (input: {
  fieldIds: string[];
  windowStart: string;
  requests: number;
  slow: number;
  totalDurationMs: number;
  maxDurationMs: number;
}) => {
  const shape = TableQueryShape.create({
    queryKind: 'search',
    searchShape: {
      fieldCount: input.fieldIds.length,
      allFields: false,
      searchedFieldIds: input.fieldIds,
      searchMode: 'full_text',
      searchScope: 'selected_fields',
      languageConfig: 'simple',
      valueLengthBucket: 'medium',
    },
    executionShape: { durationMs: input.maxDurationMs, timedOut: false },
  })._unsafeUnwrap();

  return TableQueryObservationWindow.create({
    baseId: 'bse_heat',
    tableId: 'tbl_heat',
    windowStart: new Date(input.windowStart),
    windowSizeSeconds: 300,
    shape,
    requestCount: input.requests,
    slowCount: input.slow,
    timeoutCount: 0,
    dbErrorCount: 0,
    totalDurationMs: input.totalDurationMs,
    maxDurationMs: input.maxDurationMs,
  })._unsafeUnwrap();
};

describe('SearchScopeHeatPolicy', () => {
  it('aggregates selected-field scopes and ranks sustained workload ahead of isolated spikes', () => {
    const report = new SearchScopeHeatPolicy({
      minRequestCount: 20,
      minSlowCount: 3,
      minTotalDurationMs: 5_000,
      minEstimatedRows: 10_000,
      maxScopes: 5,
    }).evaluate({
      estimatedRows: 200_000,
      observations: [
        observation({
          fieldIds: ['fld_title'],
          windowStart: '2026-07-14T00:00:00.000Z',
          requests: 40,
          slow: 5,
          totalDurationMs: 20_000,
          maxDurationMs: 2_000,
        }),
        observation({
          fieldIds: ['fld_title'],
          windowStart: '2026-07-14T00:05:00.000Z',
          requests: 30,
          slow: 4,
          totalDurationMs: 15_000,
          maxDurationMs: 1_500,
        }),
        observation({
          fieldIds: ['fld_notes'],
          windowStart: '2026-07-14T00:00:00.000Z',
          requests: 1,
          slow: 1,
          totalDurationMs: 8_000,
          maxDurationMs: 8_000,
        }),
      ],
    });

    expect(report.isOk()).toBe(true);
    expect(report._unsafeUnwrap().snapshot()).toMatchObject({
      tableId: 'tbl_heat',
      estimatedRows: 200_000,
      scannedObservationCount: 3,
      scopes: [
        {
          searchedFieldIds: ['fld_title'],
          requestCount: 70,
          slowCount: 9,
          totalDurationMs: 35_000,
          hot: true,
          nextAction: 'needs_plan_validation',
        },
        {
          searchedFieldIds: ['fld_notes'],
          requestCount: 1,
          hot: false,
          nextAction: 'no_index_change',
        },
      ],
    });
  });

  it('does not expose raw search values or metric labels in the report', () => {
    const report = new SearchScopeHeatPolicy().evaluate({
      estimatedRows: 50_000,
      observations: [
        observation({
          fieldIds: ['fld_customer'],
          windowStart: '2026-07-14T00:00:00.000Z',
          requests: 30,
          slow: 5,
          totalDurationMs: 12_000,
          maxDurationMs: 1_000,
        }),
      ],
    });

    const serialized = JSON.stringify(report._unsafeUnwrap().snapshot());
    expect(serialized).not.toContain('searchValue');
    expect(serialized).not.toContain('metricLabels');
  });
});
