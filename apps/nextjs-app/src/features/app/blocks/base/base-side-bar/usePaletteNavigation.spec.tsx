import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IViewVo } from '@teable/core';
import { HttpError, ViewType } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import type * as OpenApi from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { AnchorContext, SessionContext, TableContext } from '@teable/sdk/context';
import { Table } from '@teable/sdk/model';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseNodeContext } from '../base-node/BaseNodeContext';
import type { TreeItemData } from '../base-node/hooks';
import { readPaletteRecent, writePaletteRecent } from './palette-recent';
import { usePaletteNavigation } from './usePaletteNavigation';

const { router, getViewList, getUserLastVisitMap } = vi.hoisted(() => ({
  router: { asPath: '/base/bseOne', query: {} },
  getViewList: vi.fn(),
  getUserLastVisitMap: vi.fn(),
}));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getViewList,
  getUserLastVisitMap,
}));

const makeNode = (resourceId: string, name = resourceId): TreeItemData => ({
  id: `node-${resourceId}`,
  resourceId,
  resourceType: BaseNodeResourceType.Table,
  resourceMeta: { name },
  order: 0,
  parentId: null,
  children: [],
});
const makeView = (id: string, name = id): IViewVo => ({
  id,
  name,
  type: ViewType.Grid,
  createdBy: 'usrOne',
  createdTime: '2026-10-21T00:00:00Z',
  columnMeta: {},
});
const makeVisit = (resourceId: string, viewId?: string, lastVisited = 100) => ({
  resourceId,
  ...(viewId ? { viewId } : {}),
  lastVisited,
  visitCount: 2,
});

const setup = (
  nodes = [makeNode('tblOne', 'Current table'), makeNode('tblTwo', 'Other table')]
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const context = {
    isLoading: false,
    isLoaded: true,
    maxFolderDepth: 2,
    treeItems: Object.fromEntries(nodes.map((node) => [node.id, node])),
    setTreeItems: vi.fn(),
    invalidateMenu: vi.fn(),
  };
  const session = {
    user: {
      id: 'usrOne',
      name: 'One',
      email: 'one@example.com',
      notifyMeta: {},
      hasPassword: true,
    },
    refresh: vi.fn(),
    refreshAvatar: vi.fn(),
  };
  const tables = nodes.map((node) =>
    Object.assign(new Table(), {
      id: node.resourceId,
      name: node.resourceMeta?.name,
      defaultViewId: `viwDefault-${node.resourceId}`,
    })
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={session}>
        <AnchorContext.Provider value={{ baseId: 'bseOne' }}>
          <TableContext.Provider value={{ tables }}>
            <BaseNodeContext.Provider value={context}>{children}</BaseNodeContext.Provider>
          </TableContext.Provider>
        </AnchorContext.Provider>
      </SessionContext.Provider>
    </QueryClientProvider>
  );
  return { wrapper, queryClient, context, session };
};

describe('usePaletteNavigation with sidebar providers and no ViewProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    router.asPath = '/base/bseOne';
    getViewList.mockReset().mockImplementation(async (tableId: string) => ({
      data: [makeView(`viw-${tableId}`, `View of ${tableId}`)],
    }));
    getUserLastVisitMap.mockReset().mockResolvedValue({ data: {} });
  });
  afterEach(cleanup);

  it.each([true, false])(
    'revalidates a fresh cached list before pruning a new view visit (still exists: %s)',
    async (stillExists) => {
      const { wrapper, queryClient } = setup();
      queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 10_000 } });
      queryClient.setQueryData(ReactQueryKeys.viewList('tblOne'), [makeView('viwOld')]);
      const { promise: response, resolve: finishRequest } = Promise.withResolvers<{
        data: IViewVo[];
      }>();
      getViewList.mockReturnValue(response);
      const { result, rerender } = renderHook(
        ({ open }) => usePaletteNavigation({ baseId: 'bseOne', tableId: 'tblOne', open }),
        { wrapper, initialProps: { open: false } }
      );

      // Toolbar creation navigates shallowly; only the realtime ViewProvider knows this view.
      router.asPath = '/base/bseOne/table/tblOne/viwCreated';
      rerender({ open: false });
      expect(getViewList).not.toHaveBeenCalled();
      expect(readPaletteRecent('usrOne', 'bseOne')).toEqual([
        expect.objectContaining({ resourceId: 'tblOne', viewId: 'viwCreated' }),
      ]);

      rerender({ open: true });
      await waitFor(() => expect(getViewList).toHaveBeenCalledWith('tblOne'));
      expect(result.current.isLoading).toBe(true);
      expect(readPaletteRecent('usrOne', 'bseOne')).toEqual([
        expect.objectContaining({ resourceId: 'tblOne', viewId: 'viwCreated' }),
      ]);

      await act(async () => {
        finishRequest({
          data: [makeView('viwOld'), ...(stillExists ? [makeView('viwCreated')] : [])],
        });
        await response;
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await waitFor(() =>
        expect(readPaletteRecent('usrOne', 'bseOne')).toHaveLength(stillExists ? 1 : 0)
      );
      expect(result.current.recent.map((entry) => entry.id)).toEqual(
        stillExists ? ['tblOne/viwCreated'] : []
      );

      // A second open inside that same freshness window must revalidate again.
      rerender({ open: false });
      rerender({ open: true });
      await waitFor(() => expect(getViewList).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(readPaletteRecent('usrOne', 'bseOne')).toHaveLength(stillExists ? 1 : 0);
    }
  );

  it('loads current-table views with the canonical key and honors the last-view table href', async () => {
    getUserLastVisitMap.mockResolvedValue({ data: { tblOne: { resourceId: 'viwLast' } } });
    const { wrapper, queryClient } = setup();
    const { result } = renderHook(
      () => usePaletteNavigation({ baseId: 'bseOne', tableId: 'tblOne', open: true }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    expect(result.current.views[0]).toMatchObject({
      label: 'View of tblOne',
      description: 'Current table',
      href: '/base/bseOne/table/tblOne/viw-tblOne',
    });
    expect(queryClient.getQueryData(ReactQueryKeys.viewList('tblOne'))).toEqual([
      makeView('viw-tblOne', 'View of tblOne'),
    ]);
    await waitFor(() =>
      expect(result.current.resources[0].href).toBe('/base/bseOne/table/tblOne/viwLast')
    );
    expect(getViewList).toHaveBeenCalledTimes(1);
    expect(getViewList).toHaveBeenCalledWith('tblOne');
  });

  it('records ordinary view navigation while closed and refreshes exact cross-table recents on open', async () => {
    const { wrapper } = setup();
    router.asPath = '/base/bseOne/table/tblOne/viw-tblOne';
    const { result, rerender } = renderHook(
      ({ open, tableId }) => usePaletteNavigation({ baseId: 'bseOne', tableId, open }),
      {
        wrapper,
        initialProps: { open: false, tableId: 'tblOne' },
      }
    );
    router.asPath = '/base/bseOne/table/tblTwo/viw-tblTwo';
    rerender({ open: false, tableId: 'tblTwo' });
    expect(getViewList).not.toHaveBeenCalled();
    expect(readPaletteRecent('usrOne', 'bseOne').map((visit) => visit.viewId)).toEqual([
      'viw-tblTwo',
      'viw-tblOne',
    ]);
    rerender({ open: true, tableId: 'tblTwo' });
    await waitFor(() => expect(result.current.recent).toHaveLength(2));
    expect(result.current.recent.map((entry) => entry.href)).toEqual([
      '/base/bseOne/table/tblTwo/viw-tblTwo',
      '/base/bseOne/table/tblOne/viw-tblOne',
    ]);
    expect(result.current.recent[1]).toMatchObject({
      label: 'View of tblOne',
      description: 'Current table',
      visitCount: 1,
    });
    expect(result.current.views.map((entry) => entry.id)).toEqual(['tblTwo/viw-tblTwo']);
    router.asPath = '/base/bseOne/table/tblTwo/viw-tblTwo?recordId=recOne';
    rerender({ open: false, tableId: 'tblTwo' });
    expect(readPaletteRecent('usrOne', 'bseOne')[0].visitCount).toBe(1);
    router.asPath = '/base/bseOne/table/tblOne/viw-tblOne';
    rerender({ open: false, tableId: 'tblOne' });
    expect(readPaletteRecent('usrOne', 'bseOne')[0].visitCount).toBe(2);
  });

  it('hydrates current labels, removes unauthorized resources and missing views, and never requests forbidden tables', async () => {
    writePaletteRecent('usrOne', 'bseOne', [
      makeVisit('tblForbidden', 'viwSecret', 300),
      makeVisit('tblOne', 'viwDeleted', 200),
      makeVisit('tblTwo', 'viw-tblTwo'),
    ]);
    const { wrapper } = setup();
    const { result } = renderHook(
      () => usePaletteNavigation({ baseId: 'bseOne', tableId: 'tblOne', open: true }),
      { wrapper }
    );
    await waitFor(() =>
      expect(readPaletteRecent('usrOne', 'bseOne')).toEqual([makeVisit('tblTwo', 'viw-tblTwo')])
    );
    expect(result.current.recent).toEqual([
      expect.objectContaining({ label: 'View of tblTwo', description: 'Other table' }),
    ]);
    expect(getViewList).not.toHaveBeenCalledWith('tblForbidden');
  });

  it('does not erase unresolved history while the authorized tree is loading', async () => {
    writePaletteRecent('usrOne', 'bseOne', [makeVisit('tblTwo', 'viw-tblTwo')]);
    const { wrapper, context } = setup();
    context.isLoaded = false;
    context.isLoading = true;
    context.treeItems = {};
    const { result, rerender } = renderHook(
      () => usePaletteNavigation({ baseId: 'bseOne', open: true }),
      { wrapper }
    );
    expect(result.current.recent).toEqual([]);
    expect(readPaletteRecent('usrOne', 'bseOne')).toHaveLength(1);
    expect(getViewList).not.toHaveBeenCalled();
    context.isLoaded = true;
    context.isLoading = false;
    rerender();
    await waitFor(() => expect(readPaletteRecent('usrOne', 'bseOne')).toEqual([]));
  });

  it('drops forbidden views but preserves history for transient failures', async () => {
    writePaletteRecent('usrOne', 'bseOne', [
      makeVisit('tblOne', 'viwDenied', 200),
      makeVisit('tblTwo', 'viwOffline'),
    ]);
    getViewList.mockImplementation(async (tableId: string) => {
      throw new HttpError('Unavailable', tableId === 'tblOne' ? 403 : 500);
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => usePaletteNavigation({ baseId: 'bseOne', open: true }), {
      wrapper,
    });
    await waitFor(() =>
      expect(readPaletteRecent('usrOne', 'bseOne')).toEqual([makeVisit('tblTwo', 'viwOffline')])
    );
    expect(result.current.recent).toEqual([]);
  });

  it('bounds recent-table requests instead of fetching every project table', async () => {
    const nodes = Array.from({ length: 30 }, (_, index) => makeNode(`tbl${index}`));
    writePaletteRecent(
      'usrOne',
      'bseOne',
      nodes
        .slice(1, 12)
        .map((node, index) => makeVisit(node.resourceId, `viw-${node.resourceId}`, 100 - index))
    );
    const { wrapper } = setup(nodes);
    const { result } = renderHook(
      () => usePaletteNavigation({ baseId: 'bseOne', tableId: 'tbl0', open: true }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.recent).toHaveLength(5));
    expect(getViewList.mock.calls.map(([id]) => id)).toEqual([
      'tbl0',
      'tbl1',
      'tbl2',
      'tbl3',
      'tbl4',
      'tbl5',
    ]);
    expect(readPaletteRecent('usrOne', 'bseOne')).toHaveLength(11);
  });

  it('refreshes external history on reopen, deduplicates destinations, and isolates another user', async () => {
    getUserLastVisitMap.mockResolvedValue({ data: { tblOne: { resourceId: 'viw-tblOne' } } });
    const { wrapper, session } = setup();
    const { result, rerender } = renderHook(
      ({ open }) => usePaletteNavigation({ baseId: 'bseOne', tableId: 'tblOne', open }),
      { wrapper, initialProps: { open: false } }
    );
    writePaletteRecent('usrOne', 'bseOne', [
      makeVisit('tblOne', 'viw-tblOne', 200),
      makeVisit('tblOne'),
    ]);
    rerender({ open: true });
    await waitFor(() => expect(result.current.views).toHaveLength(1));
    await waitFor(() => expect(result.current.recent).toHaveLength(1));
    expect(result.current.recent[0].id).toBe('tblOne/viw-tblOne');
    expect(result.current.resources[0].visitCount).toBe(4);
    act(() => {
      session.user.id = 'usrTwo';
    });
    rerender({ open: true });
    expect(result.current.recent).toEqual([]);
    expect(readPaletteRecent('usrOne', 'bseOne')).toHaveLength(2);
  });
});
