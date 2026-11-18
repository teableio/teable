import { describe, expect, it } from 'vitest';

import { isServingSearchSnapshot } from './searchVectorStatus';

describe('isServingSearchSnapshot', () => {
  const snapshot = {
    version: 1 as const,
    dbTableName: 'tbl_orders',
    generatedColumnName: '__tqops_search_document',
    indexName: 'idx_tqops_search_document',
    provider: 'pg_bigm' as const,
    searchScope: 'all_fields' as const,
    definitionKey: 'definition',
    indexUsable: true,
    fields: [
      {
        fieldId: `fld${'d'.repeat(16)}`,
        fieldDbName: 'name',
        textProjection: { kind: 'plain' as const },
      },
    ],
  };

  it('serves when the published snapshot is usable and built for this table', () => {
    expect(isServingSearchSnapshot(snapshot, 'tbl_orders')).toBe(true);
  });

  it.each([
    ['unusable snapshot', { ...snapshot, indexUsable: false }, 'tbl_orders'],
    ['snapshot of another physical table', snapshot, 'tbl_other'],
    ['no snapshot', undefined, 'tbl_orders'],
    ['no table name', snapshot, null],
    ['empty coverage', { ...snapshot, fields: [] }, 'tbl_orders'],
  ])('does not serve for %s', (_label, searchIndex, tableName) => {
    expect(isServingSearchSnapshot(searchIndex, tableName)).toBe(false);
  });
});
