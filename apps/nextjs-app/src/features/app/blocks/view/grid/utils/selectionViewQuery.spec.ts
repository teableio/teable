import type { IGetRecordsRo } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { buildSelectionViewQuery } from './selectionViewQuery';

describe('buildSelectionViewQuery', () => {
  it('returns undefined when there is no personal view query', () => {
    expect(buildSelectionViewQuery({})).toBeUndefined();
  });

  it('returns the current visible projection when there is no personal view query', () => {
    expect(
      buildSelectionViewQuery({
        visibleFieldIds: ['fldVisibleA', 'fldVisibleB'],
      })
    ).toEqual({
      projection: ['fldVisibleA', 'fldVisibleB'],
    });
  });

  it('returns the full personal view query to keep frontend/backend row order in sync', () => {
    const filter: NonNullable<IGetRecordsRo['filter']> = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldValue', operator: 'is', value: 'Open' }],
    };
    const orderBy: NonNullable<IGetRecordsRo['orderBy']> = [{ fieldId: 'fldSort', order: 'desc' }];
    const groupBy: NonNullable<IGetRecordsRo['groupBy']> = [{ fieldId: 'fldGroup', order: 'asc' }];

    const personalViewCommonQuery = {
      ignoreViewQuery: true,
      filter,
      orderBy,
      groupBy,
      projection: ['fldPrimary'],
    };

    expect(buildSelectionViewQuery({ personalViewCommonQuery })).toEqual(personalViewCommonQuery);
  });

  it('uses the live visible projection to keep selection column indexes in sync', () => {
    const personalViewCommonQuery = {
      ignoreViewQuery: true,
      projection: ['fldOldA', 'fldOldB'],
    };

    expect(
      buildSelectionViewQuery({
        personalViewCommonQuery,
        visibleFieldIds: ['fldCurrentB', 'fldCurrentA'],
      })
    ).toEqual({
      ignoreViewQuery: true,
      projection: ['fldCurrentB', 'fldCurrentA'],
    });
  });

  it('returns full query when filter differs', () => {
    const personalViewCommonQuery = {
      ignoreViewQuery: true,
      filter: null,
      projection: ['fldPrimary'],
    };

    expect(buildSelectionViewQuery({ personalViewCommonQuery })).toEqual(personalViewCommonQuery);
  });

  it('returns full query with custom sorting', () => {
    const personalViewCommonQuery = {
      ignoreViewQuery: true,
      orderBy: [{ fieldId: 'fldSort', order: 'asc' as const }],
      projection: ['fldPrimary'],
    };

    expect(buildSelectionViewQuery({ personalViewCommonQuery })).toEqual(personalViewCommonQuery);
  });
});
