import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IViewVo } from '@teable/core';
import { ViewType } from '@teable/core';
import { BaseNodeResourceType, LastVisitResourceType } from '@teable/openapi';
import type * as OpenApi from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { AnchorContext, TableContext } from '@teable/sdk/context';
import { Table } from '@teable/sdk/model';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseNodeContext } from '../base-node/BaseNodeContext';
import type { TreeItemData } from '../base-node/hooks';
import { usePaletteNavigation } from './usePaletteNavigation';

const { getViewList, getUserLastVisitMap, getUserLastVisitListBaseNode } = vi.hoisted(() => ({
  getViewList: vi.fn(),
  getUserLastVisitMap: vi.fn(),
  getUserLastVisitListBaseNode: vi.fn(),
}));
vi.mock('next/router', () => ({ useRouter: () => ({ asPath: '/base/bseOne', query: {} }) }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getViewList,
  getUserLastVisitMap,
  getUserLastVisitListBaseNode,
}));

const makeNode = (
  resourceId: string,
  name = resourceId,
  resourceType = BaseNodeResourceType.Table
): TreeItemData => ({
  id: `node-${resourceId}`,
  resourceId,
  resourceType,
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
const makeVisit = (
  resourceId: string,
  lastVisitTime: string,
  resourceType = LastVisitResourceType.Table
) => ({ resourceId, resourceType, lastVisitTime });
const visitsResponse = (list: ReturnType<typeof makeVisit>[]) => ({
  data: { total: list.length, list },
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
  const tables = nodes
    .filter((node) => node.resourceType === BaseNodeResourceType.Table)
    .map((node) =>
      Object.assign(new Table(), {
        id: node.resourceId,
        name: node.resourceMeta?.name,
        defaultViewId: `viwDefault-${node.resourceId}`,
      })
    );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AnchorContext.Provider value={{ baseId: 'bseOne' }}>
        <TableContext.Provider value={{ tables }}>
          <BaseNodeContext.Provider value={context}>{children}</BaseNodeContext.Provider>
        </TableContext.Provider>
      </AnchorContext.Provider>
    </QueryClientProvider>
  );
  return { wrapper, queryClient, context };
};

describe('usePaletteNavigation with sidebar providers and no ViewProvider', () => {
  beforeEach(() => {
    getViewList.mockReset().mockImplementation(async (tableId: string) => ({
      data: [makeView(`viw-${tableId}`, `View of ${tableId}`)],
    }));
    getUserLastVisitMap.mockReset().mockResolvedValue({ data: {} });
    getUserLastVisitListBaseNode.mockReset().mockResolvedValue(visitsResponse([]));
  });
  afterEach(cleanup);

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
    expect(getViewList.mock.calls).toEqual([['tblOne']]);
  });

  it('revalidates a fresh cached view list on every open', async () => {
    const { wrapper, queryClient } = setup();
    queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 10_000 } });
    queryClient.setQueryData(ReactQueryKeys.viewList('tblOne'), [makeView('viwOld')]);
    getViewList.mockResolvedValue({ data: [makeView('viwOld'), makeView('viwCreated')] });
    const { result, rerender } = renderHook(
      ({ open }) => usePaletteNavigation({ baseId: 'bseOne', tableId: 'tblOne', open }),
      { wrapper, initialProps: { open: false } }
    );
    expect(getViewList).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => expect(result.current.views).toHaveLength(2));

    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(getViewList).toHaveBeenCalledTimes(2));
  });

  it('lists the server visit history newest first, leaving out nodes the tree does not list', async () => {
    getUserLastVisitListBaseNode.mockResolvedValue(
      visitsResponse([
        makeVisit('dshOne', '2026-11-04T10:00:00.000Z', LastVisitResourceType.Dashboard),
        makeVisit('tblForbidden', '2026-11-04T09:00:00.000Z'),
        makeVisit('tblTwo', '2026-11-04T08:00:00.000Z'),
      ])
    );
    const { wrapper } = setup([
      makeNode('tblOne', 'Current table'),
      makeNode('tblTwo', 'Other table'),
      makeNode('dshOne', 'Sales dashboard', BaseNodeResourceType.Dashboard),
    ]);
    const { result } = renderHook(
      () => usePaletteNavigation({ baseId: 'bseOne', tableId: 'tblOne', open: true }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.recent).toHaveLength(2));
    expect(getUserLastVisitListBaseNode).toHaveBeenCalledWith({ parentResourceId: 'bseOne' });
    expect(result.current.recent).toEqual([
      expect.objectContaining({ id: 'dshOne', label: 'Sales dashboard' }),
      expect.objectContaining({ id: 'tblTwo', label: 'Other table' }),
    ]);
    // Search ranks the same entries by those visit times.
    const byId = new Map(result.current.resources.map((entry) => [entry.id, entry]));
    expect(byId.get('tblTwo')?.lastVisited).toBe(Date.parse('2026-11-04T08:00:00.000Z'));
    expect(byId.get('tblOne')?.lastVisited).toBeUndefined();
  });

  it('fetches visits only while open and again on each open', async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ open }) => usePaletteNavigation({ baseId: 'bseOne', open }),
      { wrapper, initialProps: { open: false } }
    );
    expect(getUserLastVisitListBaseNode).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => expect(getUserLastVisitListBaseNode).toHaveBeenCalledTimes(1));
    expect(result.current.recent).toEqual([]);

    // A visit made in another tab or on another device since the last open.
    getUserLastVisitListBaseNode.mockResolvedValue(
      visitsResponse([makeVisit('tblTwo', '2026-11-04T08:00:00.000Z')])
    );
    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(result.current.recent.map((entry) => entry.id)).toEqual(['tblTwo']));
  });

  it('shows no recent entries until the authorized tree has loaded', async () => {
    getUserLastVisitListBaseNode.mockResolvedValue(
      visitsResponse([makeVisit('tblTwo', '2026-11-04T08:00:00.000Z')])
    );
    const { wrapper, context } = setup();
    const treeItems = context.treeItems;
    context.isLoaded = false;
    context.isLoading = true;
    context.treeItems = {};
    const { result, rerender } = renderHook(
      () => usePaletteNavigation({ baseId: 'bseOne', open: true }),
      { wrapper }
    );
    await waitFor(() => expect(getUserLastVisitListBaseNode).toHaveBeenCalled());
    expect(result.current.recent).toEqual([]);
    expect(getViewList).not.toHaveBeenCalled();

    act(() => {
      context.isLoaded = true;
      context.isLoading = false;
      context.treeItems = treeItems;
    });
    rerender();
    await waitFor(() => expect(result.current.recent.map((entry) => entry.id)).toEqual(['tblTwo']));
  });
});
