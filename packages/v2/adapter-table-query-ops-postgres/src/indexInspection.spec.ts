import type { TableQueryShapeInput } from '@teable/v2-table-query-ops';
import { describe, expect, it } from 'vitest';

import { collectBtreeAccessPathFields } from './indexInspection';

const resolveField = (fieldId: string, options?: Record<string, unknown>) => ({
  fieldId,
  fieldDbName: `db_${fieldId}`,
  ...options,
});

const snapshot = (input: Partial<TableQueryShapeInput>): TableQueryShapeInput =>
  ({
    queryKind: 'filter',
    executionShape: { durationMs: 0, timedOut: false, resultCountBucket: 'none' },
    ...input,
  }) as TableQueryShapeInput;

describe('collectBtreeAccessPathFields', () => {
  it('keeps list tie-breaker order after an equality filter', () => {
    const result = collectBtreeAccessPathFields(
      snapshot({
        whereShape: {
          conditionCount: 1,
          andDepth: 1,
          orDepth: 0,
          fields: [{ fieldId: 'fld_filter', operatorFamily: 'equality' }],
        },
        orderShape: {
          fields: [
            { source: 'sort', fieldId: 'fld_sort', direction: 'desc' },
            { source: 'tieBreaker', systemColumn: '__row_viw1', direction: 'asc' },
            { source: 'tieBreaker', systemColumn: '__auto_number', direction: 'asc' },
          ],
        },
      }),
      resolveField as never
    );

    expect(result.equalityFilterFields.map((field) => field.fieldDbName)).toEqual([
      'db_fld_filter',
    ]);
    expect(result.orderFields.map((field) => field.fieldDbName)).toEqual([
      'db_fld_sort',
      '__row_viw1',
      '__auto_number',
    ]);
  });

  it('does not turn search tie-breakers into btree order fields', () => {
    const result = collectBtreeAccessPathFields(
      snapshot({
        queryKind: 'search',
        whereShape: {
          conditionCount: 1,
          andDepth: 1,
          orDepth: 0,
          fields: [{ fieldId: 'fld_filter', operatorFamily: 'equality' }],
        },
        orderShape: {
          fields: [{ source: 'tieBreaker', systemColumn: '__auto_number', direction: 'asc' }],
        },
      }),
      resolveField as never
    );

    expect(result.orderFields).toEqual([]);
  });

  it('does not add order fields without an equality filter', () => {
    const result = collectBtreeAccessPathFields(
      snapshot({
        whereShape: {
          conditionCount: 1,
          andDepth: 1,
          orDepth: 0,
          fields: [{ fieldId: 'fld_filter', operatorFamily: 'range' }],
        },
        orderShape: {
          fields: [{ source: 'tieBreaker', systemColumn: '__auto_number', direction: 'asc' }],
        },
      }),
      resolveField as never
    );

    expect(result.equalityFilterFields).toEqual([]);
    expect(result.orderFields).toEqual([]);
  });
});
