import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ViewType } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { AnchorContext, BaseContext, SessionContext, TableContext } from '@teable/sdk/context';
import { Base, Table } from '@teable/sdk/model';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextTestStubProvider } from '../../../../../../config/tests/I18nextTestStubProvider';
import { BaseNodeContext } from '../base-node/BaseNodeContext';
import type { TreeItemData } from '../base-node/hooks';
import { CommandPalette } from './CommandPalette';

const {
  spaceSearch,
  getUserLastVisitListBase,
  getBaseAll,
  getViewList,
  getTablePermission,
  getUserLastVisitMap,
  getPublicSetting,
  getAIConfig,
} = vi.hoisted(() => ({
  spaceSearch: vi.fn(),
  getUserLastVisitListBase: vi.fn(),
  getBaseAll: vi.fn(),
  getViewList: vi.fn(),
  getTablePermission: vi.fn(),
  getUserLastVisitMap: vi.fn(),
  getPublicSetting: vi.fn(),
  getAIConfig: vi.fn(),
}));

// Keep the SDK hooks, navigation/actions hooks, and dialog intact. Only HTTP endpoints are mocked.
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  spaceSearch,
  getUserLastVisitListBase,
  getBaseAll,
  getViewList,
  getTablePermission,
  getUserLastVisitMap,
  getPublicSetting,
  getAIConfig,
}));

const setup = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router: NextRouter = {
    basePath: '',
    pathname: '/space/[spaceId]',
    route: '/space/[spaceId]',
    query: { spaceId: 'spcOne' },
    asPath: '/space/spcOne',
    push: vi.fn().mockResolvedValue(true),
    replace: vi.fn().mockResolvedValue(true),
    reload: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
    beforePopState: vi.fn(),
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    isFallback: false,
    isReady: true,
    isPreview: false,
    isLocaleDomain: false,
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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RouterContext.Provider value={router}>
        <I18nextTestStubProvider>
          <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
        </I18nextTestStubProvider>
      </RouterContext.Provider>
    </QueryClientProvider>
  );
  return { wrapper, router };
};

describe('CommandPalette provider boundaries', () => {
  beforeEach(() => {
    window.localStorage.clear();
    spaceSearch.mockReset().mockResolvedValue({
      data: {
        list: [
          {
            id: 'tblSales',
            name: 'Sales forecast',
            type: 'table',
            baseId: 'bseSales',
            baseName: 'Sales project',
          },
        ],
        nextCursor: null,
      },
    });
    getViewList.mockReset().mockResolvedValue({
      data: [
        {
          id: 'viwBoard',
          name: 'Board planning',
          type: ViewType.Kanban,
          createdBy: 'usrOne',
          createdTime: '2026-10-21T00:00:00Z',
          columnMeta: {},
        },
      ],
    });
    getTablePermission.mockReset().mockResolvedValue({ data: { table: {}, field: {}, view: {} } });
    getUserLastVisitListBase.mockReset().mockResolvedValue({
      data: {
        total: 4,
        list: [
          {
            resourceId: 'bseRecentOne',
            resourceType: 'base',
            resource: {
              id: 'bseRecentOne',
              name: 'Stale recent name',
              icon: 'old-icon',
              role: 'owner',
              spaceId: 'spcOld',
              createdBy: 'usrOne',
            },
            lastVisitTime: '2026-10-27T09:00:00.000Z',
          },
          {
            resourceId: 'bseOtherSpace',
            resourceType: 'base',
            resource: {
              id: 'bseOtherSpace',
              name: 'Other space project',
              icon: null,
              role: 'owner',
              spaceId: 'spcOther',
              createdBy: 'usrOne',
            },
            lastVisitTime: '2026-10-27T08:00:00.000Z',
          },
          {
            resourceId: 'bseSecondRecent',
            resourceType: 'base',
            resource: {
              id: 'bseSecondRecent',
              name: 'Second recent project',
              icon: null,
              role: 'owner',
              spaceId: 'spcOne',
              createdBy: 'usrOne',
            },
            lastVisitTime: '2026-10-27T07:00:00.000Z',
          },
          {
            resourceId: 'bseInaccessible',
            resourceType: 'base',
            resource: {
              id: 'bseInaccessible',
              name: 'Inaccessible project',
              icon: null,
              role: 'owner',
              spaceId: 'spcOne',
              createdBy: 'usrOne',
            },
            lastVisitTime: '2026-10-27T06:00:00.000Z',
          },
        ],
      },
    });
    getBaseAll.mockReset().mockResolvedValue({
      data: [
        {
          id: 'bseRecentOne',
          name: 'Current project name',
          icon: 'current-icon',
          role: 'owner',
          spaceId: 'spcOne',
          createdBy: 'usrOne',
        },
        {
          id: 'bseOtherSpace',
          name: 'Other space project',
          icon: null,
          role: 'owner',
          spaceId: 'spcOther',
          createdBy: 'usrOne',
        },
        {
          id: 'bseSecondRecent',
          name: 'Second recent project',
          icon: null,
          role: 'owner',
          spaceId: 'spcOne',
          createdBy: 'usrOne',
        },
      ],
    });
    getUserLastVisitMap.mockReset().mockResolvedValue({ data: {} });
    getPublicSetting.mockReset().mockResolvedValue({ data: {} });
    getAIConfig.mockReset().mockResolvedValue({ data: { disableActions: [] } });
  });
  afterEach(cleanup);

  it('shows accessible recent projects in the current space and opens the selected project', async () => {
    const user = userEvent.setup();
    const { wrapper, router } = setup();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} spaceId="spcOne" />, { wrapper });

    const recentProject = await screen.findByText('Current project name');
    const secondRecentProject = screen.getByText('Second recent project');
    expect(
      recentProject.compareDocumentPosition(secondRecentProject) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByText('Other space project')).toBeNull();
    expect(screen.queryByText('Inaccessible project')).toBeNull();
    expect(screen.queryByText('commandPalette.noRecent')).toBeNull();
    expect(getUserLastVisitListBase).toHaveBeenCalledOnce();
    expect(getBaseAll).toHaveBeenCalledOnce();
    expect(spaceSearch).not.toHaveBeenCalled();

    await user.click(recentProject);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/base/bseRecentOne'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('searches and navigates on the space page without Base, Table, Anchor, or View providers', async () => {
    const user = userEvent.setup();
    const { wrapper, router } = setup();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} spaceId="spcOne" />, { wrapper });

    await user.type(screen.getByRole('combobox'), 'Sales');
    const result = await screen.findByRole('option', { name: /Sales forecast/ });
    expect(result).toHaveTextContent('Sales project');
    expect(spaceSearch).toHaveBeenCalledWith(
      'spcOne',
      {
        search: 'Sales',
        pageSize: 20,
        cursor: undefined,
      },
      expect.any(AbortSignal)
    );
    expect(getViewList).not.toHaveBeenCalled();
    expect(getAIConfig).not.toHaveBeenCalled();
    await user.click(result);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/base/bseSales/table/tblSales'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the previous remote results visible during debounce and the replacement request', async () => {
    const user = userEvent.setup();
    const { wrapper } = setup();
    render(<CommandPalette open onOpenChange={vi.fn()} spaceId="spcOne" />, { wrapper });
    await user.type(screen.getByRole('combobox'), 'Sales');
    await screen.findByRole('option', { name: /Sales forecast/ });
    const response = {
      data: {
        list: [
          {
            id: 'tblBudget',
            name: 'Budget',
            type: 'table',
            baseId: 'bseSales',
            baseName: 'Sales project',
          },
        ],
        nextCursor: null,
      },
    };
    const pending = Promise.withResolvers<typeof response>();
    spaceSearch.mockImplementationOnce(() => pending.promise);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Budget' } });
    expect(screen.getByRole('option', { name: /Sales forecast/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(spaceSearch).toHaveBeenLastCalledWith(
        'spcOne',
        { search: 'Budget', pageSize: 20, cursor: undefined },
        expect.any(AbortSignal)
      )
    );
    expect(screen.getByRole('option', { name: /Sales forecast/ })).toBeInTheDocument();
    await act(async () => pending.resolve(response));
    await screen.findByRole('option', { name: /Budget/ });
    expect(screen.queryByRole('option', { name: /Sales forecast/ })).toBeNull();
  });

  it('loads and opens an exact view from the base sidebar without a ViewProvider', async () => {
    const user = userEvent.setup();
    const { wrapper, router } = setup();
    router.asPath = '/base/bseOne/table/tblOne/viwGrid';
    router.pathname = '/base/[baseId]/table/[tableId]/[viewId]';
    router.query = { baseId: 'bseOne', tableId: 'tblOne', viewId: 'viwGrid' };
    const base = new Base({
      id: 'bseOne',
      name: 'Current project',
      spaceId: 'spcOne',
      icon: null,
      role: 'viewer',
      createdBy: 'usrOne',
    });
    const table = Object.assign(new Table(), {
      id: 'tblOne',
      name: 'Current table',
      defaultViewId: 'viwGrid',
    });
    const node: TreeItemData = {
      id: 'nodeOne',
      resourceId: table.id,
      resourceType: BaseNodeResourceType.Table,
      resourceMeta: { name: table.name },
      order: 0,
      parentId: null,
      children: [],
    };
    const onOpenChange = vi.fn();
    render(
      <BaseContext.Provider value={{ base }}>
        <AnchorContext.Provider value={{ baseId: base.id, tableId: table.id, viewId: 'viwGrid' }}>
          <TableContext.Provider value={{ tables: [table] }}>
            <BaseNodeContext.Provider
              value={{
                isLoaded: true,
                isLoading: false,
                maxFolderDepth: 2,
                treeItems: { [node.id]: node },
                setTreeItems: vi.fn(),
                invalidateMenu: vi.fn(),
              }}
            >
              <CommandPalette open onOpenChange={onOpenChange} />
            </BaseNodeContext.Provider>
          </TableContext.Provider>
        </AnchorContext.Provider>
      </BaseContext.Provider>,
      { wrapper }
    );

    await user.type(screen.getByRole('combobox'), 'Board');
    const result = await screen.findByRole('option', { name: /Board planning/ });
    expect(result).toHaveTextContent('Current table');
    expect(getViewList).toHaveBeenCalledWith('tblOne');
    expect(spaceSearch).not.toHaveBeenCalled();
    await user.click(result);

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/base/bseOne/table/tblOne/viwBoard')
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
