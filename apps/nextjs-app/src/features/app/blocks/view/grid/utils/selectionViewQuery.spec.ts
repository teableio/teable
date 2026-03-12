import type { IGetRecordsRo } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { buildSelectionViewQuery } from './selectionViewQuery';

describe('buildSelectionViewQuery', () => {
  it('returns undefined when there is no personal view query', () => {
    expect(buildSelectionViewQuery({})).toBeUndefined();
  });

  it('drops ignoreViewQuery when personal query matches saved view query', () => {
    const filter: NonNullable<IGetRecordsRo['filter']> = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldValue', operator: 'is', value: 'Open' }],
    };
    const orderBy: NonNullable<IGetRecordsRo['orderBy']> = [{ fieldId: 'fldSort', order: 'desc' }];
    const groupBy: NonNullable<IGetRecordsRo['groupBy']> = [{ fieldId: 'fldGroup', order: 'asc' }];

    expect(
      buildSelectionViewQuery({
        view: {
          filter,
          sort: { sortObjs: orderBy },
          group: groupBy,
        },
        personalViewCommonQuery: {
          ignoreViewQuery: true,
          filter,
          orderBy,
          groupBy,
          projection: ['fldPrimary'],
        },
      })
    ).toEqual({
      projection: ['fldPrimary'],
    });
  });

  it('keeps ignoreViewQuery when personal query intentionally clears a saved filter', () => {
    const filter: NonNullable<IGetRecordsRo['filter']> = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldValue', operator: 'is', value: 'Open' }],
    };

    expect(
      buildSelectionViewQuery({
        view: {
          filter,
        },
        personalViewCommonQuery: {
          ignoreViewQuery: true,
          filter: null,
          projection: ['fldPrimary'],
        },
      })
    ).toEqual({
      ignoreViewQuery: true,
      filter: null,
      projection: ['fldPrimary'],
    });
  });

  it('keeps ignoreViewQuery when personal query changes sorting', () => {
    const orderBy: NonNullable<IGetRecordsRo['orderBy']> = [{ fieldId: 'fldSort', order: 'asc' }];

    expect(
      buildSelectionViewQuery({
        view: {
          sort: { sortObjs: [{ fieldId: 'fldSort', order: 'desc' }] },
        },
        personalViewCommonQuery: {
          ignoreViewQuery: true,
          orderBy,
          projection: ['fldPrimary'],
        },
      })
    ).toEqual({
      ignoreViewQuery: true,
      orderBy,
      projection: ['fldPrimary'],
    });
  });
});
