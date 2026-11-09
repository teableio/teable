import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IFieldVo, IRecord, IViewVo } from '@teable/core';
import { FieldType, ViewType } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import { getFields, getRecords, getViewList } from '@teable/openapi';
import { generateLocalId, ReactQueryKeys, useGridCollapsedGroupStore } from '@teable/sdk';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchTableSeed,
  resolveSeedVisibleFieldIds,
  usePrimeTableSeed,
  useTableSeed,
} from './use-table-seed';

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenApi>();
  return {
    ...actual,
    getFields: vi.fn(),
    getViewList: vi.fn(),
    getRecords: vi.fn(),
  };
});

const mockedGetFields = vi.mocked(getFields);
const mockedGetViewList = vi.mocked(getViewList);
const mockedGetRecords = vi.mocked(getRecords);

const field = (id: string, name: string, isPrimary = false): IFieldVo =>
  ({
    id,
    name,
    type: FieldType.SingleLineText,
    isPrimary,
    options: {},
  }) as unknown as IFieldVo;

const fields = [
  field('fldPrimary', 'Title', true),
  field('fldHidden', 'Hidden'),
  field('fldVisible', 'Visible'),
];
const view = {
  id: 'viwTarget',
  name: 'Target',
  type: ViewType.Grid,
  columnMeta: {
    fldPrimary: { order: 0 },
    fldHidden: { order: 1, hidden: true },
    fldVisible: { order: 2 },
  },
  sort: { sortObjs: [], manualSort: false },
} as unknown as IViewVo;

describe('resolveSeedVisibleFieldIds', () => {
  it('orders the visible fields by the view column order and skips hidden ones', () => {
    const shuffled = [fields[2], fields[1], fields[0]];

    expect(resolveSeedVisibleFieldIds(shuffled, view)).toEqual(['fldPrimary', 'fldVisible']);
  });

  it('keeps every field when there is no view to scope them', () => {
    expect(resolveSeedVisibleFieldIds(fields, undefined)).toEqual([
      'fldPrimary',
      'fldHidden',
      'fldVisible',
    ]);
  });

  it('handles a missing field list', () => {
    expect(resolveSeedVisibleFieldIds(undefined, view)).toEqual([]);
  });
});

describe('fetchTableSeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('seeds every field, unscoped by view, and projects the view-visible ones', async () => {
    mockedGetFields.mockResolvedValue({ data: fields } as never);
    mockedGetViewList.mockResolvedValue({ data: [view] } as never);
    mockedGetRecords.mockResolvedValue({
      data: { records: [], extra: { groupPoints: null } },
    } as never);

    const seed = await fetchTableSeed('tblTarget', 'viwTarget');

    // a view-scoped field query drops the view's hidden fields
    expect(mockedGetFields).toHaveBeenCalledWith('tblTarget');
    expect(seed.fields).toEqual(fields);

    const [, recordsQuery] = mockedGetRecords.mock.calls[0];
    expect(recordsQuery?.projection).toContain('fldPrimary');
    expect(recordsQuery?.projection).toContain('fldVisible');
    expect(recordsQuery?.projection).not.toContain('fldHidden');
  });

  it('asks for the grouped seed with the current collapse state', async () => {
    const groupedView = {
      ...view,
      group: [{ fieldId: 'fldPrimary', order: 'asc' }],
    } as unknown as IViewVo;
    mockedGetFields.mockResolvedValue({ data: fields } as never);
    mockedGetViewList.mockResolvedValue({ data: [groupedView] } as never);
    mockedGetRecords.mockResolvedValue({
      data: { records: [], extra: { groupPoints: null } },
    } as never);

    await fetchTableSeed('tblTarget', 'viwTarget', ['grpCollapsed']);

    const groupedCall = mockedGetRecords.mock.calls.at(-1);
    expect(groupedCall?.[1]).toMatchObject({
      groupBy: groupedView.group,
      collapsedGroupIds: ['grpCollapsed'],
    });
  });
});

describe('seed cache identity', () => {
  it('keys the seed by the navigation-time collapse state', () => {
    const collapsed = ReactQueryKeys.tableSeed('tblT', 'viwV', ['grpA']);

    expect(collapsed).toEqual(['table-seed', 'tblT', 'viwV', ['grpA']]);
    expect(collapsed).not.toEqual(ReactQueryKeys.tableSeed('tblT', 'viwV'));
    expect(collapsed).not.toEqual(ReactQueryKeys.tableSeed('tblT', 'viwV', ['grpB']));
  });
});

describe('usePrimeTableSeed', () => {
  const records = [{ id: 'recA', fields: {} }] as unknown as IRecord[];
  const serverData = {
    fieldServerData: fields,
    viewServerData: [view],
    recordsServerData: { records },
    groupPointsServerDataMap: { viwTarget: null },
  };
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const seedOf = (collapsedGroupIds?: readonly string[]) =>
    queryClient.getQueryData(ReactQueryKeys.tableSeed('tblTarget', 'viwTarget', collapsedGroupIds));
  // a prime creates its query synchronously, before the data lands
  const primed = (viewId: string, collapsedGroupIds?: readonly string[]) =>
    queryClient.getQueryState(ReactQueryKeys.tableSeed('tblTarget', viewId, collapsedGroupIds)) !==
    undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient();
    useGridCollapsedGroupStore.setState({ collapsedGroupMap: {} });
  });
  afterEach(cleanup);

  it("serves the page's snapshot as the seed, so the table fetches nothing", async () => {
    renderHook(() => usePrimeTableSeed(serverData, 'tblTarget', 'viwTarget', true), { wrapper });
    await waitFor(() => expect(seedOf()).toBeDefined());

    const { result } = renderHook(() => useTableSeed('tblTarget', 'viwTarget', true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      fields,
      views: [view],
      records: { records },
      groupPoints: null,
    });
    expect(mockedGetFields).not.toHaveBeenCalled();
    expect(mockedGetViewList).not.toHaveBeenCalled();
    expect(mockedGetRecords).not.toHaveBeenCalled();
  });

  it('leaves a locally collapsed view to fetch its own seed', async () => {
    const key = generateLocalId('tblTarget', 'viwTarget');
    useGridCollapsedGroupStore.setState({ collapsedGroupMap: { [key]: ['grpA'] } });

    renderHook(() => usePrimeTableSeed(serverData, 'tblTarget', 'viwTarget', true), { wrapper });

    expect(primed('viwTarget', ['grpA'])).toBe(false);
    expect(primed('viwTarget')).toBe(false);
  });

  it('describes only the anchor the page loaded on', async () => {
    const { rerender } = renderHook(
      ({ viewId, enabled }) => usePrimeTableSeed(serverData, 'tblTarget', viewId, enabled),
      { wrapper, initialProps: { viewId: 'viwTarget', enabled: false } }
    );
    rerender({ viewId: 'viwOther', enabled: true });
    rerender({ viewId: 'viwTarget', enabled: true });

    expect(primed('viwOther')).toBe(false);
    expect(primed('viwTarget')).toBe(false);
  });

  it('seeds once', async () => {
    const { rerender } = renderHook(
      ({ data }) => usePrimeTableSeed(data, 'tblTarget', 'viwTarget', true),
      { wrapper, initialProps: { data: serverData } }
    );
    await waitFor(() => expect(seedOf()).toBeDefined());
    queryClient.clear();

    rerender({ data: { ...serverData, recordsServerData: { records: [] } } });

    expect(primed('viwTarget')).toBe(false);
  });
});
