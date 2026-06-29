import { SortFunc } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { buildSelectionViewQuery, getSelectionGroupBy } from './selectionViewQuery';

describe('buildSelectionViewQuery', () => {
  it('returns undefined when there is no personal view query', () => {
    expect(buildSelectionViewQuery({})).toBeUndefined();
  });

  it('does not send projection for a normal view even when fields are visible', () => {
    // For a normal (server-side) view the backend already knows the view's
    // visible fields/order, so sending projection is redundant and only bloats
    // the query string. With many fields this overflows the URL limit and the
    // request fails (nginx 414 Request URI Too Large). See T4797.
    expect(
      buildSelectionViewQuery({
        visibleFieldIds: ['fldVisibleA', 'fldVisibleB'],
      })
    ).toBeUndefined();
  });

  it('omits projection for a normal view with a large number of fields', () => {
    const manyFieldIds = Array.from({ length: 200 }, (_, index) => `fldField${index}`);

    expect(
      buildSelectionViewQuery({
        visibleFieldIds: manyFieldIds,
      })
    ).toBeUndefined();
  });

  it('returns the full personal view query to keep frontend/backend row order in sync', () => {
    const filter: NonNullable<IGetRecordsRo['filter']> = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldValue', operator: 'is', value: 'Open' }],
    };
    const orderBy: NonNullable<IGetRecordsRo['orderBy']> = [
      { fieldId: 'fldSort', order: SortFunc.Desc },
    ];
    const groupBy: NonNullable<IGetRecordsRo['groupBy']> = [
      { fieldId: 'fldGroup', order: SortFunc.Asc },
    ];

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
      orderBy: [{ fieldId: 'fldSort', order: SortFunc.Asc }],
      projection: ['fldPrimary'],
    };

    expect(buildSelectionViewQuery({ personalViewCommonQuery })).toEqual(personalViewCommonQuery);
  });

  it('uses the personal view group for selection operations when it differs from the saved view', () => {
    const viewGroup: NonNullable<IGetRecordsRo['groupBy']> = [
      { fieldId: 'fldSavedGroup', order: SortFunc.Asc },
    ];
    const personalGroup: NonNullable<IGetRecordsRo['groupBy']> = [
      { fieldId: 'fldLiveGroup', order: SortFunc.Desc },
    ];

    expect(
      getSelectionGroupBy({
        selectionViewQuery: {
          ignoreViewQuery: true,
          groupBy: personalGroup,
        },
        viewGroup,
      })
    ).toEqual(personalGroup);
  });

  it('keeps an intentionally empty personal view group instead of falling back to the saved view', () => {
    const viewGroup: NonNullable<IGetRecordsRo['groupBy']> = [
      { fieldId: 'fldSavedGroup', order: SortFunc.Asc },
    ];

    expect(
      getSelectionGroupBy({
        selectionViewQuery: {
          ignoreViewQuery: true,
          groupBy: [],
        },
        viewGroup,
      })
    ).toEqual([]);
  });

  it('keeps an ungrouped personal view request instead of falling back to the saved view', () => {
    const viewGroup: NonNullable<IGetRecordsRo['groupBy']> = [
      { fieldId: 'fldSavedGroup', order: SortFunc.Asc },
    ];

    expect(
      getSelectionGroupBy({
        selectionViewQuery: {
          ignoreViewQuery: true,
        },
        viewGroup,
      })
    ).toBeUndefined();
  });

  it('falls back to the saved view group when there is no personal view query', () => {
    const viewGroup: NonNullable<IGetRecordsRo['groupBy']> = [
      { fieldId: 'fldSavedGroup', order: SortFunc.Asc },
    ];

    expect(
      getSelectionGroupBy({
        viewGroup,
      })
    ).toEqual(viewGroup);
  });
});
