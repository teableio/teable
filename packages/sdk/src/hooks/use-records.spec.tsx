import type { IFilter, ISort } from '@teable/core';
import { extractFieldIdsFromFilter, SortFunc } from '@teable/core';
import type { ShareViewGetVo } from '@teable/openapi';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareViewContext } from '../context/table/ShareViewContext';
import { useInstances } from '../context/use-instances';
import { useRecords } from './use-records';
import { useView } from './use-view';

vi.mock('../context/use-instances', () => ({
  useInstances: vi.fn(() => ({ instances: [], extra: undefined })),
}));
vi.mock('./use-fields', () => ({ useFields: vi.fn(() => []) }));
vi.mock('./use-search', () => ({ useSearch: vi.fn(() => ({ filteringSearchQuery: undefined })) }));
vi.mock('./use-table-id', () => ({ useTableId: vi.fn(() => 'tblTest') }));
vi.mock('./use-view-id', () => ({ useViewId: vi.fn(() => 'viwShare') }));
vi.mock('./use-view', () => ({ useView: vi.fn() }));

const mockedUseView = vi.mocked(useView);
const mockedUseInstances = vi.mocked(useInstances);

const storedFilter: IFilter = {
  conjunction: 'and',
  filterSet: [{ fieldId: 'fldStored', operator: 'is', value: 'x' }],
};
const visitorFilter: IFilter = {
  conjunction: 'and',
  filterSet: [{ fieldId: 'fldVisitor', operator: 'is', value: 'y' }],
};
const storedSort: ISort = { sortObjs: [{ fieldId: 'fldSorted', order: SortFunc.Asc }] };

const mockView = (view: { id: string; filter?: IFilter | null; sort?: ISort | null }) =>
  mockedUseView.mockReturnValue(view as unknown as ReturnType<typeof useView>);

const shareWrapper = (view: { id: string; filter?: IFilter | null; sort?: ISort | null }) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ShareViewContext.Provider value={{ shareId: 'shrTest', view } as ShareViewGetVo}>
      {children}
    </ShareViewContext.Provider>
  );
  wrapper.displayName = 'ShareViewWrapper';
  return wrapper;
};

const getSubscribedQuery = () => {
  return mockedUseInstances.mock.calls.at(-1)?.[0].queryParams as {
    ignoreViewQuery?: boolean;
    filter?: IFilter;
    orderBy?: { fieldId: string }[];
  };
};

describe('useRecords subscription query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inlines the view filter outside share', () => {
    mockView({ id: 'viwShare', filter: storedFilter });

    renderHook(() => useRecords());

    const query = getSubscribedQuery();
    expect(query.ignoreViewQuery).toBe(true);
    expect(extractFieldIdsFromFilter(query.filter, true)).toContain('fldStored');
  });

  it('inlines the stored share view filter/sort the proxy nulls out, merged with the visitor filter', () => {
    // ShareViewProxy nulls the proxied view's filter/sort, keeping only the
    // visitor's local overrides
    mockView({ id: 'viwShare', filter: visitorFilter, sort: null });

    renderHook(() => useRecords(), {
      wrapper: shareWrapper({ id: 'viwShare', filter: storedFilter, sort: storedSort }),
    });

    const query = getSubscribedQuery();
    expect(query.ignoreViewQuery).toBe(true);
    const filterFieldIds = extractFieldIdsFromFilter(query.filter, true);
    expect(filterFieldIds).toContain('fldStored');
    expect(filterFieldIds).toContain('fldVisitor');
    expect(query.orderBy?.map((item) => item.fieldId)).toContain('fldSorted');
  });

  it('ignores the share view conditions when the subscription targets another view', () => {
    mockView({ id: 'viwOther', filter: null, sort: null });

    renderHook(() => useRecords(), {
      wrapper: shareWrapper({ id: 'viwOther2', filter: storedFilter, sort: storedSort }),
    });

    const query = getSubscribedQuery();
    expect(extractFieldIdsFromFilter(query.filter, true)).not.toContain('fldStored');
    expect(query.orderBy ?? []).toHaveLength(0);
  });
});
