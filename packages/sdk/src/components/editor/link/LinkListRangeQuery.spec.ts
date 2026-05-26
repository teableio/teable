import type { IGetRecordsRo } from '@teable/openapi';
import { IdReturnType, RangeType } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { buildLinkRangeToIdQuery } from './LinkListRangeQuery';

describe('buildLinkRangeToIdQuery', () => {
  it('keeps the link picker record query when resolving selected row ranges', () => {
    const ranges: [number, number][] = [[0, 2]];
    const query = buildLinkRangeToIdQuery(
      ranges,
      {
        search: ['TEST-ABNA'],
        filterLinkCellCandidate: ['fldSourceLink', 'recHostRecord'],
        skip: 100,
        take: 50,
      } as IGetRecordsRo,
      'viwCurrent'
    );

    expect(query).toMatchObject({
      ranges,
      type: RangeType.Rows,
      returnType: IdReturnType.RecordId,
      viewId: 'viwCurrent',
      search: ['TEST-ABNA'],
      filterLinkCellCandidate: ['fldSourceLink', 'recHostRecord'],
    });
    expect(query).not.toHaveProperty('skip');
    expect(query).not.toHaveProperty('take');
  });

  it('prefers the rendered record query view over the surrounding view', () => {
    const query = buildLinkRangeToIdQuery(
      [[1, 3]],
      { viewId: 'viwForeignFiltered' } as IGetRecordsRo,
      'viwCurrent'
    );

    expect(query.viewId).toBe('viwForeignFiltered');
  });
});
