import { SortFunc, type IRecord } from '@teable/core';
import type { IGetRecordsRo, IGroupPointsVo } from '@teable/openapi';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFields, usePersonalView, useSearch, useView } from '../../../hooks';
import { useRecords } from '../../../hooks/use-records';
import { viewportFieldIds } from '../../../utils/column-projection';
import { useGridViewCacheStore } from '../store/useGridViewCacheStore';
import { useGridAsyncRecords } from './use-grid-async-records';

vi.mock('../../../hooks', () => ({
  useSearch: vi.fn(),
  useView: vi.fn(),
  useFields: vi.fn(() => []),
  useTableId: () => 'tblTest',
  usePersonalView: vi.fn(() => ({ isPersonalView: false })),
}));

vi.mock('../../../hooks/use-records', () => ({
  useRecords: vi.fn(),
}));

const mockedUseSearch = vi.mocked(useSearch);
const mockedUseView = vi.mocked(useView);
const mockedUseFields = vi.mocked(useFields);
const mockedUsePersonalView = vi.mocked(usePersonalView);
const mockedUseRecords = vi.mocked(useRecords);

const createRecord = (id: string) => ({ id, fields: {} }) as IRecord;

const wideFields = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `fld${String(i).padStart(2, '0')}`,
  }));

const setupViewportFill = (fieldCount = 40) => {
  const fields = wideFields(fieldCount);
  const fillProjectedRecordFields = vi.fn(async () => true);
  const subscribeProjection = fields.slice(0, 24).map((field) => field.id);
  mockedUseFields.mockReturnValue(fields as never);
  mockedUseRecords.mockReturnValue({
    records: [{ id: 'rec1', fields: {} }],
    extra: undefined,
    fillProjectedRecordFields,
    subscribeProjection,
  } as unknown as ReturnType<typeof useRecords>);
  return {
    fillProjectedRecordFields,
    expectedMissing: (x: number, width: number) =>
      viewportFieldIds({
        orderedVisibleFieldIds: fields.map((field) => field.id),
        startColumnIndex: x,
        columnSpan: width,
        freezeCount: 1,
      }).filter((fieldId) => !subscribeProjection.includes(fieldId)),
  };
};
const mockUseRecordsResult = (
  records: IRecord[],
  extra?: unknown,
  queryScopeKey = 'scope'
): ReturnType<typeof useRecords> =>
  ({
    records,
    extra,
    fillProjectedRecordFields: vi.fn(async () => true),
    subscribeProjection: [],
    queryScopeKey,
  }) as unknown as ReturnType<typeof useRecords>;

describe('useGridAsyncRecords', () => {
  beforeEach(() => {
    mockedUseSearch.mockReturnValue({ searchQuery: undefined } as ReturnType<typeof useSearch>);
    mockedUseView.mockReset();
    mockedUseRecords.mockReset();
    mockedUsePersonalView.mockReturnValue({ isPersonalView: false } as never);
    mockedUseFields.mockReturnValue([] as never);
    useGridViewCacheStore.setState({ cacheMap: {} });
  });

  it('keeps SSR records and group points on the initial render', () => {
    mockedUseRecords.mockReturnValue(mockUseRecordsResult([createRecord('recSsr')]));

    const initGroupPoints = [{ id: 'grpSsr' }] as IGroupPointsVo;
    const { result } = renderHook(() =>
      useGridAsyncRecords([createRecord('recSsr')], undefined, undefined, initGroupPoints)
    );

    expect(result.current.recordMap[0]?.id).toBe('recSsr');
    expect(result.current.groupPoints).toBe(initGroupPoints);
  });

  it('clears stale records and group points when the record query scope changes', async () => {
    let records = [createRecord('recOld')];
    let extra = { groupPoints: [{ id: 'grpOld' }] as IGroupPointsVo };
    let scopeKey = 'scope-old';
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records, extra, scopeKey));

    const initGroupPoints = [{ id: 'grpSsr' }] as IGroupPointsVo;
    const oldQuery = {
      groupBy: [{ fieldId: 'fldOldGroup', order: SortFunc.Asc }],
    } as Pick<IGetRecordsRo, 'groupBy'>;
    const newQuery = {
      groupBy: [{ fieldId: 'fldNewGroup', order: SortFunc.Asc }],
    } as Pick<IGetRecordsRo, 'groupBy'>;

    const { result, rerender } = renderHook(
      ({ outerQuery }) => useGridAsyncRecords(undefined, undefined, outerQuery, initGroupPoints),
      { initialProps: { outerQuery: oldQuery } }
    );

    expect(result.current.recordMap[0]?.id).toBe('recOld');
    expect(result.current.groupPoints).toEqual(extra.groupPoints);

    records = [createRecord('recNew')];
    extra = undefined as unknown as typeof extra;
    // a group change re-creates the subscription, which re-delivers on ready
    scopeKey = 'scope-new';
    rerender({ outerQuery: newQuery });

    await waitFor(() => {
      expect(result.current.recordMap).toEqual({});
      expect(result.current.groupPoints).toBeNull();
    });
  });

  it('seeds cached group points when switching back to a previously visited view', async () => {
    let currentView = { id: 'viwA', filter: null };
    let records = [createRecord('recA')];
    let extra: { groupPoints: IGroupPointsVo } | undefined = {
      groupPoints: [{ id: 'grpA' }] as IGroupPointsVo,
    };
    // subscription identity follows the view, so every switch re-creates it
    let scopeKey = 'scope-A';
    mockedUseView.mockImplementation(() => currentView as unknown as ReturnType<typeof useView>);
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records, extra, scopeKey));

    const queryA = {
      groupBy: [{ fieldId: 'fldA', order: SortFunc.Asc }],
    } as Pick<IGetRecordsRo, 'groupBy'>;
    const queryB = {
      groupBy: [{ fieldId: 'fldB', order: SortFunc.Asc }],
    } as Pick<IGetRecordsRo, 'groupBy'>;

    const { result, rerender } = renderHook(
      ({ outerQuery }) => useGridAsyncRecords(undefined, undefined, outerQuery),
      { initialProps: { outerQuery: queryA } }
    );
    // view A settled: group points cached for viwA
    expect(result.current.groupPoints).toEqual([{ id: 'grpA' }]);

    // switch to a never-visited view B: no cache, structure unknown
    currentView = { id: 'viwB', filter: null };
    records = [];
    extra = undefined;
    scopeKey = 'scope-B';
    rerender({ outerQuery: queryB });
    await waitFor(() => expect(result.current.groupPoints).toBeNull());

    // switch back to view A before the subscription delivers: the first
    // frame already carries A's cached group structure
    currentView = { id: 'viwA', filter: null };
    scopeKey = 'scope-A';
    rerender({ outerQuery: queryA });
    await waitFor(() => expect(result.current.groupPoints).toEqual([{ id: 'grpA' }]));
  });

  it('swaps to the target view cached group points on a view-query-only switch', async () => {
    let currentView = { id: 'viwA', filter: null };
    const records = [createRecord('recA')];
    mockedUseView.mockImplementation(() => currentView as unknown as ReturnType<typeof useView>);
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records));

    // both views group by the same field → identical outer query
    const sharedQuery = {
      groupBy: [{ fieldId: 'fldShared', order: SortFunc.Asc }],
    } as Pick<IGetRecordsRo, 'groupBy'>;
    useGridViewCacheStore
      .getState()
      .setGroupPoints('tblTest-viwB', [{ id: 'grpB' }] as IGroupPointsVo);

    const { result, rerender } = renderHook(() =>
      useGridAsyncRecords(undefined, undefined, sharedQuery)
    );

    currentView = { id: 'viwB', filter: null };
    rerender();

    await waitFor(() => expect(result.current.groupPoints).toEqual([{ id: 'grpB' }]));
  });

  it('never retains another view rows on a same-scope view switch without a snapshot', async () => {
    let currentView = { id: 'viwA', filter: null };
    let records = [createRecord('recA')];
    mockedUseView.mockImplementation(() => currentView as unknown as ReturnType<typeof useView>);
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records));

    const { result, rerender } = renderHook(() => useGridAsyncRecords());
    expect(result.current.recordMap[0]?.id).toBe('recA');

    // switch to a never-visited view with the same records scope: the old
    // view's rows must not stay on screen — loading placeholders instead
    currentView = { id: 'viwB', filter: null };
    records = [];
    rerender();

    await waitFor(() => {
      expect(result.current.recordMap).toEqual({});
    });
  });

  it('seeds the target view row snapshot when switching back', async () => {
    let currentView = { id: 'viwA', filter: null };
    let records = [createRecord('recA')];
    mockedUseView.mockImplementation(() => currentView as unknown as ReturnType<typeof useView>);
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records));

    const { result, rerender } = renderHook(() => useGridAsyncRecords());
    expect(result.current.recordMap[0]?.id).toBe('recA');

    // leave view A: its first-screen rows are snapshotted as plain data
    currentView = { id: 'viwB', filter: null };
    records = [];
    rerender();
    await waitFor(() => {
      const snapshot = useGridViewCacheStore.getState().cacheMap['tblTest-viwA']?.rows;
      expect(snapshot?.[0]?.id).toBe('recA');
      // pure data red line: no instance internals may leak into the store
      expect(Object.keys(snapshot?.[0] ?? {})).not.toContain('doc');
      expect(Object.keys(snapshot?.[0] ?? {})).not.toContain('fieldMap');
    });

    // view B delivers its own rows
    records = [createRecord('recB')];
    rerender();
    await waitFor(() => expect(result.current.recordMap[0]?.id).toBe('recB'));

    // switch back to view A before its subscription delivers: the first
    // frame already carries A's last known rows
    currentView = { id: 'viwA', filter: null };
    records = [];
    rerender();
    await waitFor(() => {
      expect(result.current.recordMap[0]?.id).toBe('recA');
    });
  });

  it('replaces the seeded snapshot entirely on the first fresh delivery (no stale tail)', async () => {
    let currentView = { id: 'viwA', filter: null };
    let records = [createRecord('recA1'), createRecord('recA2')];
    let extra: unknown = { groupPoints: null };
    mockedUseView.mockImplementation(() => currentView as unknown as ReturnType<typeof useView>);
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records, extra));

    const { result, rerender } = renderHook(() => useGridAsyncRecords());
    expect(result.current.recordMap[1]?.id).toBe('recA2');

    // leave and come back: two rows seeded from the snapshot
    currentView = { id: 'viwB', filter: null };
    records = [];
    extra = undefined;
    rerender();
    currentView = { id: 'viwA', filter: null };
    rerender();
    await waitFor(() => expect(result.current.recordMap[1]?.id).toBe('recA2'));

    // the live result shrank to one row while the user was away: the fresh
    // delivery must drop the seeded tail instead of retaining it
    records = [createRecord('recA1')];
    extra = { groupPoints: null };
    rerender();
    await waitFor(() => {
      expect(result.current.recordMap[0]?.id).toBe('recA1');
      expect(result.current.recordMap[1]).toBeUndefined();
    });
  });

  it('preserves record permissions in the snapshot', async () => {
    let currentView = { id: 'viwA', filter: null };
    let records = [
      {
        id: 'recSecured',
        fields: {},
        permissions: { read: { fldX: true }, update: { fldX: false } },
        undeletable: true,
      } as unknown as IRecord,
    ];
    mockedUseView.mockImplementation(() => currentView as unknown as ReturnType<typeof useView>);
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records));

    const { rerender } = renderHook(() => useGridAsyncRecords());

    currentView = { id: 'viwB', filter: null };
    records = [];
    rerender();

    await waitFor(() => {
      const snapshot = useGridViewCacheStore.getState().cacheMap['tblTest-viwA']?.rows;
      expect(snapshot?.[0]?.permissions).toEqual({ read: { fldX: true }, update: { fldX: false } });
      expect(snapshot?.[0]?.undeletable).toBe(true);
    });
  });

  it('evicts an obsolete snapshot when the view settles empty', async () => {
    // a previous visit cached one row
    useGridViewCacheStore.getState().setRows('tblTest-viwA', [createRecord('recStale')]);

    let currentView = { id: 'viwA', filter: null };
    const records: IRecord[] = [];
    // the subscription settles: zero records is the authoritative result
    const extra = { groupPoints: null };
    mockedUseView.mockImplementation(() => currentView as unknown as ReturnType<typeof useView>);
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records, extra));

    const { rerender } = renderHook(() => useGridAsyncRecords());

    currentView = { id: 'viwB', filter: null };
    rerender();

    await waitFor(() => {
      expect(useGridViewCacheStore.getState().cacheMap['tblTest-viwA']?.rows).toBeUndefined();
    });
  });

  it('does not touch the per-view cache when the hook runs with its own initQuery', async () => {
    let currentView = { id: 'viwA', filter: null };
    let records = [createRecord('recEmbedded')];
    mockedUseView.mockImplementation(() => currentView as unknown as ReturnType<typeof useView>);
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records));

    // stable identity — the hook treats initQuery as a stable input (real
    // callers memoize it); an inline literal would re-trigger query effects
    const embeddedQuery = { take: 50 };
    const { rerender } = renderHook(() => useGridAsyncRecords(undefined, embeddedQuery));

    currentView = { id: 'viwB', filter: null };
    records = [];
    rerender();

    await waitFor(() => {
      expect(useGridViewCacheStore.getState().cacheMap).toEqual({});
    });
  });

  it('clears a stale cached group structure when the fresh one is empty or oversized', () => {
    const store = useGridViewCacheStore.getState();
    store.setGroupPoints('keyA', [{ id: 'grpOld' }] as IGroupPointsVo);
    expect(useGridViewCacheStore.getState().cacheMap.keyA?.groupPoints).toBeDefined();

    // grew past the cacheable limit: the old structure must go too
    const oversized = Array.from({ length: 5001 }, (_, i) => ({ id: `grp${i}` }));
    useGridViewCacheStore.getState().setGroupPoints('keyA', oversized as IGroupPointsVo);
    expect(useGridViewCacheStore.getState().cacheMap.keyA).toBeUndefined();

    // empty structure (view ungrouped) clears instead of occupying a slot
    useGridViewCacheStore.getState().setGroupPoints('keyB', [{ id: 'grpB' }] as IGroupPointsVo);
    useGridViewCacheStore.getState().setGroupPoints('keyB', [] as unknown as IGroupPointsVo);
    expect(useGridViewCacheStore.getState().cacheMap.keyB).toBeUndefined();
  });

  it('drops retained records but keeps the current page when the view filter changes', async () => {
    let records = [createRecord('recA'), createRecord('recStale')];
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records));
    mockedUseView.mockReturnValue({ id: 'viwTest', filter: null } as unknown as ReturnType<
      typeof useView
    >);

    const { result, rerender } = renderHook(() => useGridAsyncRecords());

    await waitFor(() => {
      expect(result.current.recordMap[1]?.id).toBe('recStale');
    });

    // the fresh page shrinks to one record; the old second row stays as retained cache
    records = [createRecord('recA')];
    rerender();
    await waitFor(() => {
      expect(result.current.recordMap[0]?.id).toBe('recA');
    });
    expect(result.current.recordMap[1]?.id).toBe('recStale');

    mockedUseView.mockReturnValue({
      id: 'viwTest',
      filter: { conjunction: 'and', filterSet: [] },
    } as unknown as ReturnType<typeof useView>);
    rerender();

    await waitFor(() => {
      expect(result.current.recordMap[1]).toBeUndefined();
    });
    expect(result.current.recordMap[0]?.id).toBe('recA');
  });

  it('clears the current page when hide-not-match search changes', async () => {
    const searchState: {
      searchQuery: [string, string, boolean] | undefined;
      hideNotMatchRow: boolean;
    } = { searchQuery: undefined, hideNotMatchRow: true };
    const records = [createRecord('recDefault')];
    mockedUseSearch.mockImplementation(() => searchState as ReturnType<typeof useSearch>);
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records));
    mockedUseView.mockReturnValue({ id: 'viwTest', filter: null } as unknown as ReturnType<
      typeof useView
    >);

    const { result, rerender } = renderHook(() => useGridAsyncRecords());
    expect(result.current.recordMap[0]?.id).toBe('recDefault');

    searchState.searchQuery = ['probe', 'fldName', true];
    rerender();

    await waitFor(() => {
      expect(result.current.recordMap).toEqual({});
    });
  });

  it('keeps the current page when hide-not-match is enabled without a search value', async () => {
    const searchState: {
      searchQuery: [string, string, boolean] | undefined;
      hideNotMatchRow: boolean;
    } = { searchQuery: undefined, hideNotMatchRow: false };
    const records = [createRecord('recDefault')];
    mockedUseSearch.mockImplementation(() => searchState as ReturnType<typeof useSearch>);
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records));
    mockedUseView.mockReturnValue({ id: 'viwTest', filter: null } as unknown as ReturnType<
      typeof useView
    >);

    const { result, rerender } = renderHook(() => useGridAsyncRecords());
    expect(result.current.recordMap[0]?.id).toBe('recDefault');

    searchState.hideNotMatchRow = true;
    rerender();

    await waitFor(() => {
      expect(result.current.recordMap[0]?.id).toBe('recDefault');
    });
  });

  it('wipes the cache when the record query scope and the view query change together', async () => {
    const records = [createRecord('recOld')];
    let scopeKey = 'scope-old';
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records, undefined, scopeKey));
    mockedUseView.mockReturnValue({ id: 'viwTest', filter: null } as unknown as ReturnType<
      typeof useView
    >);

    const oldQuery = {
      groupBy: [{ fieldId: 'fldOldGroup', order: SortFunc.Asc }],
    } as Pick<IGetRecordsRo, 'groupBy'>;
    const newQuery = {
      groupBy: [{ fieldId: 'fldNewGroup', order: SortFunc.Asc }],
    } as Pick<IGetRecordsRo, 'groupBy'>;

    const { result, rerender } = renderHook(
      ({ outerQuery }) => useGridAsyncRecords(undefined, undefined, outerQuery),
      { initialProps: { outerQuery: oldQuery } }
    );

    await waitFor(() => {
      expect(result.current.recordMap[0]?.id).toBe('recOld');
    });

    // a group change flips both keys in the same render; the wipe must win,
    // because the re-created subscription is guaranteed to deliver fresh data
    mockedUseView.mockReturnValue({
      id: 'viwTest',
      filter: null,
      group: [{ fieldId: 'fldNewGroup' }],
    } as unknown as ReturnType<typeof useView>);
    scopeKey = 'scope-new';
    rerender({ outerQuery: newQuery });

    await waitFor(() => {
      expect(result.current.recordMap).toEqual({});
    });
  });

  it('keeps the loaded rows when the query props change shape but the subscription is reused', async () => {
    // enabling the personal view re-shapes the records query — explicit
    // ignoreViewQuery/filter/orderBy props instead of the view-id form, plus its
    // own group-points cache slot — while the conditions inlined into the
    // subscription stay the same and the live query is reused. No second ready
    // snapshot is coming, so wiping the rows would leave placeholders that never
    // resolve until a remount (T7486).
    const records = [createRecord('recShared')];
    const extra = { groupPoints: [{ id: 'grpShared' }] as IGroupPointsVo };
    mockedUseRecords.mockReturnValue(mockUseRecordsResult(records, extra, 'shared-scope'));

    const groupBy = [{ fieldId: 'fldGroup', order: SortFunc.Asc }];
    const sharedQuery = { groupBy } as Pick<IGetRecordsRo, 'groupBy'>;
    const personalQuery = {
      ignoreViewQuery: true,
      groupBy,
      projection: ['fldPrimary'],
    } as Pick<IGetRecordsRo, 'groupBy' | 'ignoreViewQuery' | 'projection'>;

    const { result, rerender } = renderHook(
      ({ outerQuery }) => useGridAsyncRecords(undefined, undefined, outerQuery),
      { initialProps: { outerQuery: sharedQuery } }
    );
    expect(result.current.recordMap[0]?.id).toBe('recShared');
    expect(result.current.groupPoints).toEqual(extra.groupPoints);

    mockedUsePersonalView.mockReturnValue({ isPersonalView: true } as never);
    rerender({ outerQuery: personalQuery });

    await waitFor(() => {
      expect(result.current.recordMap[0]?.id).toBe('recShared');
    });
    expect(result.current.groupPoints).toEqual(extra.groupPoints);
  });

  it('wipes and adopts a swapped initQuery for an embedded grid', async () => {
    // an embedded grid (PreviewTable) initializes its window state from
    // initQuery on mount only, so a swapped initQuery must take the wipe path:
    // that reset is what rebuilds the window — and therefore the subscription —
    // from the new query. Keeping the rows here would leave the grid on the
    // previous query's result set.
    const records = [createRecord('recStale')];
    mockedUseRecords.mockReturnValue(mockUseRecordsResult(records, undefined, 'embedded-scope'));

    const { result, rerender } = renderHook(
      ({ initQuery }: { initQuery: IGetRecordsRo }) => useGridAsyncRecords(undefined, initQuery),
      {
        initialProps: {
          initQuery: {
            orderBy: [{ fieldId: 'fldA', order: SortFunc.Asc }],
          } as IGetRecordsRo,
        },
      }
    );

    // scroll the embedded grid off its initial window, so the reset below has
    // to rebuild the window instead of leaving the loaded one in place
    act(() => {
      result.current.onVisibleRegionChanged({ x: 0, y: 2000, width: 5, height: 600 });
    });
    await waitFor(() => {
      expect(result.current.recordsQuery.skip).toBeGreaterThan(0);
    });
    const scrolledWindow = result.current.recordsQuery;

    rerender({
      initQuery: { orderBy: [{ fieldId: 'fldB', order: SortFunc.Asc }] } as IGetRecordsRo,
    });

    await waitFor(() => {
      expect(result.current.recordMap).toEqual({});
      expect(result.current.recordsQuery.orderBy).toEqual([
        { fieldId: 'fldB', order: SortFunc.Asc },
      ]);
    });
    expect(result.current.recordsQuery).not.toEqual(scrolledWindow);
  });

  // shared two-group fixture for the collapse/expand tests below
  type IOuterQuery = Pick<IGetRecordsRo, 'groupBy' | 'collapsedGroupIds'>;
  const GROUP_BY = [{ fieldId: 'fldGroup', order: SortFunc.Asc }];
  const TWO_GROUP_POINTS = [
    { id: 'grpA', type: 0, depth: 0, value: 'A', isCollapsed: false },
    { type: 1, count: 2 },
    { id: 'grpB', type: 0, depth: 0, value: 'B', isCollapsed: false },
    { type: 1, count: 2 },
  ] as IGroupPointsVo;
  const renderTwoGroupGrid = () => {
    mockedUseRecords.mockReturnValue(
      mockUseRecordsResult(
        [
          createRecord('recA1'),
          createRecord('recA2'),
          createRecord('recB1'),
          createRecord('recB2'),
        ],
        { groupPoints: TWO_GROUP_POINTS }
      )
    );
    mockedUseView.mockReturnValue({ id: 'viwTest', filter: null } as unknown as ReturnType<
      typeof useView
    >);
    return renderHook(({ outerQuery }) => useGridAsyncRecords(undefined, undefined, outerQuery), {
      initialProps: { outerQuery: { groupBy: GROUP_BY } as IOuterQuery },
    });
  };

  it('patches the layout in place on a collapse toggle instead of wiping to placeholders', async () => {
    const { result, rerender } = renderTwoGroupGrid();
    expect(result.current.recordMap[3]?.id).toBe('recB2');

    // collapse group A: the layout and loaded rows repaint in place — group B
    // shifts up with its rows, nothing drops to loading placeholders
    rerender({ outerQuery: { groupBy: GROUP_BY, collapsedGroupIds: ['grpA'] } });

    expect(result.current.groupPoints).toEqual([
      { id: 'grpA', type: 0, depth: 0, value: 'A', isCollapsed: true },
      { id: 'grpB', type: 0, depth: 0, value: 'B', isCollapsed: false },
      { type: 1, count: 2 },
    ]);
    expect(result.current.recordMap[0]?.id).toBe('recB1');
    expect(result.current.recordMap[1]?.id).toBe('recB2');
    expect(result.current.recordMap[2]).toBeUndefined();

    // the re-created subscription delivers server truth the patch could not
    // know (a row was added to group B meanwhile): it replaces the patched
    // state entirely
    const freshGroupPoints = [
      { id: 'grpA', type: 0, depth: 0, value: 'A', isCollapsed: true },
      { id: 'grpB', type: 0, depth: 0, value: 'B', isCollapsed: false },
      { type: 1, count: 3 },
    ] as IGroupPointsVo;
    mockedUseRecords.mockReturnValue(
      mockUseRecordsResult([createRecord('recB1'), createRecord('recB2'), createRecord('recB3')], {
        groupPoints: freshGroupPoints,
      })
    );
    rerender({ outerQuery: { groupBy: GROUP_BY, collapsedGroupIds: ['grpA'] } });

    await waitFor(() => {
      expect(result.current.groupPoints).toEqual(freshGroupPoints);
      expect(result.current.recordMap[2]?.id).toBe('recB3');
    });
  });

  it('re-expands a group in place using its cached row count, keeping rows behind it', () => {
    const { result, rerender } = renderTwoGroupGrid();

    // collapse A (its row count is cached from the delivered points), then
    // expand it back before any fresh delivery arrives
    rerender({ outerQuery: { groupBy: GROUP_BY, collapsedGroupIds: ['grpA'] } });
    rerender({ outerQuery: { groupBy: GROUP_BY } });

    // the layout is restored in place: A shows a loading block of its known
    // size while B's rows keep their content at their exact positions
    expect(result.current.groupPoints).toEqual(TWO_GROUP_POINTS);
    expect(result.current.recordMap[0]).toBeUndefined();
    expect(result.current.recordMap[1]).toBeUndefined();
    expect(result.current.recordMap[2]?.id).toBe('recB1');
    expect(result.current.recordMap[3]?.id).toBe('recB2');
  });

  it('does not reuse cached row counts across a view filter change', () => {
    const { result, rerender } = renderTwoGroupGrid();

    rerender({ outerQuery: { groupBy: GROUP_BY, collapsedGroupIds: ['grpA'] } });

    // the view filter changes while A is collapsed: its cached count now
    // describes a different result set and must be dropped
    mockedUseView.mockReturnValue({
      id: 'viwTest',
      filter: { conjunction: 'and', filterSet: [] },
    } as unknown as ReturnType<typeof useView>);
    rerender({ outerQuery: { groupBy: GROUP_BY, collapsedGroupIds: ['grpA'] } });

    rerender({ outerQuery: { groupBy: GROUP_BY } });

    // expanding falls back to loading placeholders instead of placing rows
    // with a count from the pre-filter result set
    expect(result.current.groupPoints).toEqual([
      { id: 'grpA', type: 0, depth: 0, value: 'A', isCollapsed: false },
      { id: 'grpB', type: 0, depth: 0, value: 'B', isCollapsed: false },
      { type: 1, count: 2 },
    ]);
    expect(result.current.recordMap).toEqual({});
  });

  it('does not keep empty cache slots in the loaded record map when loading a later window', async () => {
    mockedUseRecords.mockReturnValue(
      mockUseRecordsResult([createRecord('rec1'), createRecord('rec2')])
    );

    const initQuery = { skip: 3300, take: 300 };
    const { result } = renderHook(() => useGridAsyncRecords(undefined, initQuery));

    await waitFor(() => {
      expect(Object.keys(result.current.recordMap)).toEqual(['3300', '3301']);
    });
  });

  it('does not change the row window when only the column viewport moves', () => {
    mockedUseRecords.mockReturnValue(mockUseRecordsResult([createRecord('recVisible')]));

    const { result, unmount } = renderHook(() => useGridAsyncRecords());
    const skip = result.current.recordsQuery.skip ?? 0;

    act(() => {
      result.current.onVisibleRegionChanged({ x: 12, y: 0, width: 8, height: 20 });
    });

    expect(result.current.recordsQuery.skip).toBe(skip);
    unmount();
  });

  it('does not fill before the grid reports a visible region', async () => {
    const { fillProjectedRecordFields } = setupViewportFill();
    const { unmount } = renderHook(() => useGridAsyncRecords());

    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 50);
      await promise;
    });
    expect(fillProjectedRecordFields).not.toHaveBeenCalled();
    unmount();
  });

  it('fills freeze, viewport, and overscan columns for a one-row region', async () => {
    const { fillProjectedRecordFields, expectedMissing } = setupViewportFill();
    const { result, unmount } = renderHook(() => useGridAsyncRecords());

    act(() => {
      result.current.onVisibleRegionChanged({ x: 30, y: 0, width: 5, height: 0 });
    });
    await waitFor(() => {
      expect(fillProjectedRecordFields).toHaveBeenCalledWith(expectedMissing(30, 5));
    });
    unmount();
  });

  it('fills a single visible column when width is 0', async () => {
    const { fillProjectedRecordFields, expectedMissing } = setupViewportFill();
    const { result, unmount } = renderHook(() => useGridAsyncRecords());

    act(() => {
      result.current.onVisibleRegionChanged({ x: 30, y: 0, width: 0, height: 0 });
    });
    await waitFor(() => {
      expect(fillProjectedRecordFields).toHaveBeenCalledWith(expectedMissing(30, 0));
    });
    unmount();
  });

  it('fills later freeze columns that sit outside the subscribe prefix', async () => {
    const fields = wideFields(40);
    const fillProjectedRecordFields = vi.fn(async (_fieldIds: string[]) => true);
    const subscribeProjection = fields.slice(0, 24).map((field) => field.id);
    mockedUseFields.mockReturnValue(fields as never);
    mockedUseView.mockReturnValue({
      id: 'viwTest',
      options: { frozenFieldId: 'fld30' },
    } as never);
    mockedUseRecords.mockReturnValue({
      records: [{ id: 'rec1', fields: {} }],
      extra: undefined,
      fillProjectedRecordFields,
      subscribeProjection,
    } as unknown as ReturnType<typeof useRecords>);

    const { result, unmount } = renderHook(() => useGridAsyncRecords());
    act(() => {
      result.current.onVisibleRegionChanged({ x: 35, y: 0, width: 5, height: 0 });
    });
    await waitFor(() => {
      const filled = fillProjectedRecordFields.mock.calls.flatMap(([fieldIds]) => fieldIds);
      expect(filled).toContain('fld30');
      expect(filled).toContain('fld39');
    });
    unmount();
  });
});
