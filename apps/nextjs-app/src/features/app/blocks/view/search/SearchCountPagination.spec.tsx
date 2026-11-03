// @vitest-environment jsdom
import {
  getShareViewSearchCellCount,
  getShareViewSearchIndex,
  getShareViewSearchMatches,
} from '@teable/openapi';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchCountPagination } from './SearchCountPagination';

const state = vi.hoisted(() => ({
  infinite: {
    data: {
      pages: [] as Array<{
        data: Array<{ recordId: string; fieldId: string; index: number }>;
        nextCursor: number | null;
      }>,
    },
    isFetching: false,
    isLoading: false,
    isError: true,
    fetchNextPage: vi.fn(async () => ({ isError: false, data: undefined })),
    refetch: vi.fn(async () => undefined),
  },
  infiniteOptions: undefined as
    | {
        queryKey?: readonly unknown[];
        queryFn?: (context: { pageParam?: number | null }) => Promise<unknown>;
        refetchOnReconnect?: unknown;
      }
    | undefined,
  countOptions: undefined as
    | { queryKey?: readonly unknown[]; queryFn?: () => Promise<unknown> }
    | undefined,
  view: {
    id: 'viwTest',
    shareId: 'shrTest',
    filter: null as unknown,
    group: [] as unknown[],
    sort: null as unknown,
    columnMeta: {} as Record<string, unknown>,
  },
  fields: [] as Array<{ id: string }>,
  search: {
    value: 'probe',
    searchQuery: ['probe', '', false] as [string, string, boolean],
    hideNotMatchRow: false,
  },
  setSearchCursor: vi.fn(),
  countRefetch: vi.fn(async () => undefined),
  listenerMatches: [] as string[],
  notifyFieldChange: undefined as (() => void) | undefined,
}));

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: (options: NonNullable<typeof state.infiniteOptions>) => {
    state.infiniteOptions = options;
    return state.infinite;
  },
  useQuery: (options: NonNullable<typeof state.countOptions>) => {
    state.countOptions = options;
    return { data: { matchedCellCount: 2 }, refetch: state.countRefetch };
  },
}));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  getShareViewSearchMatches: vi.fn(async () => ({
    data: { matches: [], nextSkip: null },
  })),
  getShareViewSearchCellCount: vi.fn(async () => ({ data: { matchedCellCount: 0 } })),
  getShareViewSearchIndex: vi.fn(async () => ({ data: [] })),
}));
vi.mock('@teable/icons', () => ({
  ChevronLeft: () => <span>previous</span>,
  ChevronRight: () => <span>next</span>,
}));
vi.mock('@teable/sdk', () => ({}));
vi.mock('@teable/sdk/hooks', () => ({
  useTableId: () => 'tblTest',
  useView: () => state.view,
  useFields: () => state.fields,
  useSearch: () => state.search,
  usePersonalView: () => ({ isPersonalView: false, personalViewCommonQuery: undefined }),
  useTableListener: (
    _tableId: string | undefined,
    matches: string[],
    callback: (actionKey: string) => void
  ) => {
    state.listenerMatches = matches;
    state.notifyFieldChange = () => callback('setField');
  },
}));
vi.mock('@teable/ui-lib/base', () => ({ Spin: () => <span>loading</span> }));
vi.mock('@teable/ui-lib/shadcn', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('../grid/useGridSearchStore', () => ({
  useGridSearchStore: () => ({
    gridRef: { current: null },
    setSearchCursor: state.setSearchCursor,
  }),
}));

beforeEach(() => {
  state.infinite.data = { pages: [{ data: [], nextCursor: 100 }] };
  state.infinite.isFetching = false;
  state.infinite.isLoading = false;
  state.infinite.isError = true;
  state.infinite.fetchNextPage.mockClear();
  state.infinite.refetch.mockClear();
  state.infiniteOptions = undefined;
  state.countOptions = undefined;
  state.view.filter = null;
  state.view.group = [];
  state.view.sort = null;
  state.view.columnMeta = {};
  state.fields = [];
  state.search.hideNotMatchRow = false;
  state.countRefetch.mockClear();
  state.listenerMatches = [];
  state.notifyFieldChange = undefined;
  state.setSearchCursor.mockClear();
  vi.mocked(getShareViewSearchMatches).mockClear();
  vi.mocked(getShareViewSearchIndex).mockClear();
  vi.mocked(getShareViewSearchCellCount).mockClear();
});

describe('SearchCountPagination recovery', () => {
  it('retries an empty failed scan on demand and resumes empty-page scanning', async () => {
    const view = render(<SearchCountPagination />);
    const next = screen.getByText('next').closest('button');
    expect(next).not.toBeNull();
    fireEvent.click(next!);
    expect(state.infinite.refetch).toHaveBeenCalledTimes(1);

    state.infinite.isError = false;
    view.rerender(<SearchCountPagination />);
    await waitFor(() => expect(state.infinite.fetchNextPage).toHaveBeenCalledTimes(1));
  });

  it('asks React Query to recover the scan when connectivity returns', () => {
    render(<SearchCountPagination />);
    expect(state.infiniteOptions?.refetchOnReconnect).toBe('always');
  });

  it('refreshes navigation and exact count after field formatting changes', () => {
    render(<SearchCountPagination />);
    expect(state.listenerMatches).toEqual(
      expect.arrayContaining(['addField', 'setField', 'deleteField'])
    );
    act(() => state.notifyFieldChange?.());
    expect(state.infinite.refetch).toHaveBeenCalledTimes(1);
    expect(state.countRefetch).toHaveBeenCalledTimes(1);
  });

  it('uses the same visible-field projection for shared navigation and count requests', async () => {
    const filter = { conjunction: 'and', filterSet: [{ fieldId: 'fldVisible' }] };
    state.fields = [{ id: 'fldVisible' }];
    state.view.filter = filter;

    render(<SearchCountPagination shareView />);
    await state.infiniteOptions?.queryFn?.({ pageParam: 0 });
    await state.countOptions?.queryFn?.();

    expect(getShareViewSearchMatches).toHaveBeenCalledWith(
      'shrTest',
      expect.objectContaining({ filter, projection: ['fldVisible'] })
    );
    expect(getShareViewSearchCellCount).toHaveBeenCalledWith(
      'shrTest',
      expect.objectContaining({ filter, projection: ['fldVisible'] })
    );
  });

  it('skips locally hidden hits without changing shared row pagination or target index', async () => {
    state.fields = [{ id: 'fldVisible' }];
    state.search.hideNotMatchRow = true;
    const serverHits = Array.from({ length: 100 }, (_, index) => ({
      recordId: `rec${index}`,
      fieldId: index === 99 ? 'fldVisible' : 'fldOwnerHidden',
      index: index + 1,
    }));
    vi.mocked(getShareViewSearchIndex).mockResolvedValueOnce({ data: serverHits } as never);

    const view = render(<SearchCountPagination shareView />);
    const page = (await state.infiniteOptions?.queryFn?.({ pageParam: 0 })) as {
      data: Array<{ recordId: string; fieldId: string; index: number }>;
      nextCursor: number | null;
    };

    expect(vi.mocked(getShareViewSearchIndex).mock.calls[0]?.[1]).not.toHaveProperty('projection');
    expect(page.data).toEqual([serverHits[99]]);
    expect(page.nextCursor).toBe(100);

    state.infinite.data = { pages: [page] };
    state.infinite.isError = false;
    view.rerender(<SearchCountPagination shareView />);

    await waitFor(() => expect(state.setSearchCursor).toHaveBeenLastCalledWith([0, 99]));
  });

  it('does not let an unchanged refetch result anchor reset the next navigation', async () => {
    state.fields = [{ id: 'fldVisible' }];
    state.infinite.data = {
      pages: [
        {
          data: [
            { recordId: 'recA', fieldId: 'fldVisible', index: 1 },
            { recordId: 'recB', fieldId: 'fldVisible', index: 2 },
          ],
          nextCursor: null,
        },
      ],
    };
    state.infinite.isError = false;

    render(<SearchCountPagination />);
    fireEvent.click(screen.getByText('next').closest('button')!);
    await waitFor(() => expect(screen.getByText('2/2')).toBeTruthy());

    act(() => state.notifyFieldChange?.());
    expect(state.infinite.refetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('previous').closest('button')!);

    await waitFor(() => expect(screen.getByText('1/2')).toBeTruthy());
    expect(state.setSearchCursor).toHaveBeenLastCalledWith([0, 0]);
  });

  it('invalidates shared navigation and count when the owner filter changes in place', () => {
    const view = render(<SearchCountPagination shareView />);
    const navigationScope = state.infiniteOptions?.queryKey?.[2];
    const countScope = state.countOptions?.queryKey?.[2];

    state.view.filter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldStatus', operator: 'is', value: 'Open' }],
    };
    view.rerender(<SearchCountPagination shareView />);

    expect(state.infiniteOptions?.queryKey?.[2]).not.toEqual(navigationScope);
    expect(state.countOptions?.queryKey?.[2]).not.toEqual(countScope);
  });
});
