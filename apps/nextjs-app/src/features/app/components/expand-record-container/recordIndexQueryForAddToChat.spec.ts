import { describe, expect, it } from 'vitest';

import {
  recordIndexFallbackQuery,
  recordIndexQueryForAddToChat,
} from './recordIndexQueryForAddToChat';

describe('recordIndexQueryForAddToChat', () => {
  const active = {
    tableId: 'tblActive',
    viewId: 'viwActive',
    query: {
      viewId: 'viwActive',
      filter: { conjunction: 'and' as const, filterSet: [] },
      search: ['active'] as [string],
    },
  };

  it('does not borrow the active view when a linked record omits viewId', () => {
    expect(
      recordIndexQueryForAddToChat(
        { tableId: 'tblActive', recordId: 'recLinked', search: ['linked'] as [string] },
        active
      )
    ).toEqual({
      recordId: 'recLinked',
      viewId: undefined,
      search: ['linked'],
    });
  });

  it('reuses the active query only when the view id matches', () => {
    expect(
      recordIndexQueryForAddToChat(
        { tableId: 'tblActive', recordId: 'recCurrent', viewId: 'viwActive' },
        active
      )
    ).toEqual({
      viewId: 'viwActive',
      filter: active.query.filter,
      search: ['active'],
      recordId: 'recCurrent',
    });
  });

  it('retries outside the view filter without borrowing that filter', () => {
    const query = recordIndexQueryForAddToChat(
      {
        tableId: 'tblActive',
        recordId: 'recOutside',
        viewId: 'viwActive',
        search: ['shown'] as [string],
      },
      active
    );

    expect(recordIndexFallbackQuery(query)).toEqual({
      recordId: 'recOutside',
      ignoreViewQuery: true,
      search: ['shown'],
    });
    expect(recordIndexFallbackQuery({ ...query, ignoreViewQuery: true })).toBeUndefined();
  });
});
