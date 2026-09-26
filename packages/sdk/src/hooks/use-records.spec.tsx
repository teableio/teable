import type { IFilter, ISort } from '@teable/core';
import { extractFieldIdsFromFilter, SortFunc } from '@teable/core';
import type { ShareViewGetVo } from '@teable/openapi';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareViewContext } from '../context/table/ShareViewContext';
import { useInstances } from '../context/use-instances';
import { useFields } from './use-fields';
import { useRecords } from './use-records';
import { useSearch } from './use-search';
import { useView } from './use-view';

const { mockFields } = vi.hoisted(() => ({
  mockFields: [
    { id: 'fldStored', canReadFieldRecord: true },
    { id: 'fldVisitor', canReadFieldRecord: true },
    { id: 'fldSorted', canReadFieldRecord: true },
    { id: 'fldDenied', canReadFieldRecord: false },
  ],
}));

vi.mock('../context/use-instances', async (importOriginal) => {
  // keep the module's real helpers (e.g. the query scope key) and stub the hook
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useInstances: vi.fn(() => ({ instances: [], extra: undefined })) };
});
vi.mock('./use-fields', () => ({
  useFields: vi.fn((options?: { withDenied?: boolean }) =>
    options?.withDenied
      ? mockFields
      : mockFields.filter((field) => field.canReadFieldRecord !== false)
  ),
}));
vi.mock('./use-search', () => ({ useSearch: vi.fn(() => ({ filteringSearchQuery: undefined })) }));
vi.mock('./use-table-id', () => ({ useTableId: vi.fn(() => 'tblTest') }));
vi.mock('./use-view-id', () => ({ useViewId: vi.fn(() => 'viwShare') }));
vi.mock('./use-view', () => ({ useView: vi.fn() }));

const mockedUseView = vi.mocked(useView);
const mockedUseInstances = vi.mocked(useInstances);
const mockedUseSearch = vi.mocked(useSearch);

const storedFilter: IFilter = {
  conjunction: 'and',
  filterSet: [{ fieldId: 'fldStored', operator: 'is', value: 'x' }],
};
const visitorFilter: IFilter = {
  conjunction: 'and',
  filterSet: [{ fieldId: 'fldVisitor', operator: 'is', value: 'y' }],
};
const storedSort: ISort = { sortObjs: [{ fieldId: 'fldSorted', order: SortFunc.Asc }] };

const mockView = (view: {
  id: string;
  filter?: IFilter | null;
  sort?: ISort | null;
  options?: { frozenFieldId?: string };
}) => mockedUseView.mockReturnValue(view as unknown as ReturnType<typeof useView>);

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
    search?: [string, string, boolean];
    projection?: string[];
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

  it('keeps the inlined view filter when hide-not-match search is active', () => {
    mockedUseSearch.mockReturnValue({
      filteringSearchQuery: ['Cup', 'fldType', true],
    } as ReturnType<typeof useSearch>);
    mockView({ id: 'viwShare', filter: storedFilter });

    renderHook(() => useRecords());

    const query = getSubscribedQuery();
    expect(query.search).toEqual(['Cup', 'fldType', true]);
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

  it('keeps unreadable saved filters while stripping unreadable view sorts', () => {
    // Mask-aware server filters need the complete saved predicate and skipPoll
    // dependency set; response-hidden sorts remain client-filtered.
    mockView({
      id: 'viwShare',
      filter: {
        conjunction: 'and',
        filterSet: [
          { fieldId: 'fldStored', operator: 'is', value: 'x' },
          { fieldId: 'fldDenied', operator: 'is', value: 'y' },
        ],
      },
      sort: {
        sortObjs: [
          { fieldId: 'fldDenied', order: SortFunc.Desc },
          { fieldId: 'fldSorted', order: SortFunc.Asc },
        ],
      },
    });

    renderHook(() => useRecords());

    const query = getSubscribedQuery();
    expect(extractFieldIdsFromFilter(query.filter, true)).toEqual(['fldStored', 'fldDenied']);
    expect(query.orderBy?.map((item) => item.fieldId)).toEqual(['fldSorted']);
  });

  it('keeps explicit query sort/filter for server-side query-access policy', () => {
    mockView({ id: 'viwShare', filter: null, sort: null });

    renderHook(() =>
      useRecords({
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldDenied', operator: 'is', value: 'y' }],
        },
        orderBy: [{ fieldId: 'fldDenied', order: SortFunc.Asc }],
      })
    );

    const query = getSubscribedQuery();
    expect(extractFieldIdsFromFilter(query.filter, true)).toContain('fldDenied');
    expect(query.orderBy?.map((item) => item.fieldId)).toContain('fldDenied');
  });

  it('keeps an explicit empty projection for ids-only reads', () => {
    mockView({ id: 'viwShare', filter: null, sort: null });

    renderHook(() => useRecords({ ignoreViewQuery: true, projection: [] }));

    expect(getSubscribedQuery().projection).toEqual([]);
  });

  it('does not truncate a wide view unless sparse column fill is enabled', () => {
    const wide = Array.from({ length: 40 }, (_, i) => ({
      id: `fld${String(i).padStart(2, '0')}`,
      canReadFieldRecord: true,
      isPrimary: i === 0,
    }));
    vi.mocked(useFields).mockImplementation(() => wide as unknown as ReturnType<typeof useFields>);
    mockView({ id: 'viwShare', filter: null, sort: null });

    renderHook(() => useRecords());

    const projection = getSubscribedQuery().projection ?? [];
    expect(projection).toHaveLength(40);
    expect(projection).toContain('fld39');
  });

  it('uses a sorted stable prefix when sparse column fill is enabled', () => {
    const wide = Array.from({ length: 40 }, (_, i) => ({
      id: `fld${String(i).padStart(2, '0')}`,
      canReadFieldRecord: true,
      isPrimary: i === 0,
    }));
    vi.mocked(useFields).mockImplementation(() => wide as unknown as ReturnType<typeof useFields>);
    mockView({ id: 'viwShare', filter: null, sort: null });

    renderHook(() => useRecords(undefined, undefined, { sparseColumnFill: true }));

    const projection = getSubscribedQuery().projection ?? [];
    expect(projection).toHaveLength(24);
    expect(projection).toEqual([...projection].sort());
    expect(projection).toContain('fld00');
    expect(projection).not.toContain('fld39');
  });

  it('keeps a frozen column past the subscribe prefix when sparse fill is on', () => {
    const wide = Array.from({ length: 40 }, (_, i) => ({
      id: `fld${String(i).padStart(2, '0')}`,
      canReadFieldRecord: true,
      isPrimary: i === 0,
    }));
    vi.mocked(useFields).mockImplementation(() => wide as unknown as ReturnType<typeof useFields>);
    mockView({
      id: 'viwShare',
      filter: null,
      sort: null,
      options: { frozenFieldId: 'fld30' },
    });

    renderHook(() => useRecords(undefined, undefined, { sparseColumnFill: true }));

    const projection = getSubscribedQuery().projection ?? [];
    expect(projection).toContain('fld00');
    expect(projection).toContain('fld30');
    expect(projection.length).toBeGreaterThanOrEqual(24);
    expect(projection).not.toContain('fld39');
  });

  it('keeps an explicit hidden readable field outside the visible column set', () => {
    const visible = [{ id: 'fldTitle', canReadFieldRecord: true, isPrimary: true }];
    const all = [...visible, { id: 'fldCover', canReadFieldRecord: true, isPrimary: false }];
    vi.mocked(useFields).mockImplementation(
      (options?: { withDenied?: boolean; withHidden?: boolean }) =>
        (options?.withDenied || options?.withHidden ? all : visible) as unknown as ReturnType<
          typeof useFields
        >
    );
    mockView({ id: 'viwShare', filter: null, sort: null });

    renderHook(() => useRecords({ ignoreViewQuery: true, projection: ['fldTitle', 'fldCover'] }));

    expect(getSubscribedQuery().projection).toEqual(['fldCover', 'fldTitle']);
  });
});
