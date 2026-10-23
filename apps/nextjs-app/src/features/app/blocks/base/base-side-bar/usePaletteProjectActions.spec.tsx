// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ViewType } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import { BaseNodeResourceType, getTablePermission } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { AnchorContext, TableContext } from '@teable/sdk/context';
import type * as SdkHooks from '@teable/sdk/hooks';
import { Table } from '@teable/sdk/model';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGridSearchStore } from '../../view/grid/useGridSearchStore';
import { createPaletteSearchIndex, searchPaletteEntries } from './command-palette-utils';
import { usePaletteProjectActions } from './usePaletteProjectActions';

const state = vi.hoisted(() => ({
  permissions: {
    canCreateTable: true,
    canCreateDashboard: true,
    canCreateApp: true,
    canCreateWorkflow: true,
    canCreateRoutine: true,
    canCreateFolder: true,
  },
  basePermission: { 'base|invite_email': true },
  tablePermission: { 'view|create': true },
  createNode: vi.fn(),
  createView: vi.fn(),
  onCreateSuccess: undefined as undefined | ((node: unknown) => void),
  toast: vi.fn(),
}));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkHooks>()),
  useBase: () => ({ id: 'bse1', name: 'Project', spaceId: 'spc1' }),
  useBasePermission: () => state.basePermission,
}));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getTablePermission: vi.fn(() => Promise.resolve({ data: { view: state.tablePermission } })),
}));
vi.mock('../base-node/hooks/useBaseNodeCreatePermissions', () => ({
  useBaseNodeCreatePermissions: () => state.permissions,
}));
vi.mock('../base-node/hooks/useBaseNodeCrud', () => ({
  useBaseNodeCrud: (options: { onCreateSuccess: typeof state.onCreateSuccess }) => {
    state.onCreateSuccess = options.onCreateSuccess;
    return { createNode: state.createNode };
  },
}));
vi.mock('../../table-list/useAddTable', () => ({
  useDefaultFields: () => [{ name: 'Name' }],
  DEFAULT_EMPTY_RECORDS: [{}, {}, {}],
}));
vi.mock('@/features/app/components/collaborator/share/ShareBaseDialog', () => ({
  BaseInviteDialog: () => <div>Invite collaborators</div>,
}));
vi.mock('@teable/ui-lib/shadcn/ui/sonner', () => ({ toast: { success: state.toast } }));

const setup = () => {
  const onNavigate = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const table = new Table();
  table.id = 'tbl1';
  table.createView = state.createView;
  // Match sidebar ancestry: TableContext exists, but no ViewProvider or TablePermissionProvider.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AnchorContext.Provider value={{ baseId: 'bse1', tableId: 'tbl1', viewId: 'viw1' }}>
        <TableContext.Provider value={{ tables: [table] }}>{children}</TableContext.Provider>
      </AnchorContext.Provider>
    </QueryClientProvider>
  );
  return {
    ...renderHook(() => usePaletteProjectActions({ baseId: 'bse1', tableId: 'tbl1', onNavigate }), {
      wrapper,
    }),
    onNavigate,
    client,
  };
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(state.permissions).forEach((key) => {
    state.permissions[key as keyof typeof state.permissions] = true;
  });
  state.basePermission['base|invite_email'] = true;
  state.tablePermission['view|create'] = true;
  state.createView.mockResolvedValue({ data: { id: 'viwNew' } });
  useGridSearchStore.setState({ searchTarget: null });
});

describe('project palette actions', () => {
  it('uses full table defaults and routes the successful resource', async () => {
    const { result, onNavigate } = setup();
    expect(
      searchPaletteEntries(createPaletteSearchIndex(result.current.commands), '新建表')[0]?.id
    ).toBe('create-table');
    await act(async () => {
      await result.current.makeCreateTable?.('Customers').execute?.();
    });
    expect(state.createNode).toHaveBeenCalledWith({
      resourceType: BaseNodeResourceType.Table,
      name: 'Customers',
      fields: [{ name: 'Name' }],
      views: [{ name: 'table:view.category.table', type: ViewType.Grid }],
      records: [{}, {}, {}],
    });
    act(() =>
      state.onCreateSuccess?.({
        resourceType: BaseNodeResourceType.Table,
        resourceId: 'tblNew',
        resourceMeta: { defaultViewId: 'viwNew' },
      })
    );
    expect(onNavigate).toHaveBeenCalledWith('/base/bse1/table/tblNew/viwNew');
  });

  it('loads API permission and creates every standard view without page-only providers', async () => {
    const { result, onNavigate } = setup();
    await waitFor(() =>
      expect(result.current.commands.some((entry) => entry.id === 'create-view-grid')).toBe(true)
    );
    expect(getTablePermission).toHaveBeenCalledWith('bse1', 'tbl1');
    for (const type of [
      ViewType.Grid,
      ViewType.Gallery,
      ViewType.Kanban,
      ViewType.Calendar,
      ViewType.Form,
    ]) {
      await act(async () => {
        await result.current.commands
          .find((entry) => entry.id === `create-view-${type}`)
          ?.execute?.();
      });
      expect(state.createView).toHaveBeenLastCalledWith({ type, name: expect.any(String) });
    }
    expect(onNavigate).toHaveBeenCalledTimes(5);
  });

  it('omits forbidden creation, view, invite and search actions', async () => {
    Object.keys(state.permissions).forEach((key) => {
      state.permissions[key as keyof typeof state.permissions] = false;
    });
    state.basePermission['base|invite_email'] = false;
    state.tablePermission['view|create'] = false;
    const { result, client } = setup();
    await waitFor(() =>
      expect(client.getQueryState(ReactQueryKeys.getTablePermission('bse1', 'tbl1'))?.status).toBe(
        'success'
      )
    );
    expect(result.current.commands).toEqual([]);
    expect(result.current.makeCreateTable).toBeUndefined();
    expect(result.current.makeSearchTable).toBeUndefined();
    expect(result.current.overlays).toBeNull();
  });

  it('uses actual node creation for all non-table resources and confirms folders', async () => {
    const { result, onNavigate } = setup();
    for (const type of [
      BaseNodeResourceType.Dashboard,
      BaseNodeResourceType.App,
      BaseNodeResourceType.Workflow,
      BaseNodeResourceType.Routine,
      BaseNodeResourceType.Folder,
    ]) {
      await act(async () => {
        await result.current.commands.find((entry) => entry.id === `create-${type}`)?.execute?.();
      });
      expect(state.createNode).toHaveBeenLastCalledWith({
        resourceType: type,
        name: expect.any(String),
      });
    }
    act(() =>
      state.onCreateSuccess?.({ resourceType: BaseNodeResourceType.Folder, resourceId: 'fld1' })
    );
    expect(onNavigate).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledWith('common:commandPalette.folderCreated');
  });

  it('rejects a mismatched view and never sends a captured command to a replacement consumer', () => {
    const open = vi.fn();
    const unregister = useGridSearchStore
      .getState()
      .registerSearchTarget({ tableId: 'tbl1', viewId: 'viwOther', open });
    const { result } = setup();
    expect(result.current.makeSearchTable).toBeUndefined();
    act(() => {
      unregister();
      useGridSearchStore.getState().registerSearchTarget({ tableId: 'tbl1', viewId: 'viw1', open });
    });
    const command = result.current.makeSearchTable?.('needle');
    act(() => {
      useGridSearchStore.setState({ searchTarget: null });
    });
    command?.execute?.();
    expect(open).not.toHaveBeenCalled();
    expect(result.current.makeSearchTable).toBeUndefined();
  });

  it('opens the invitation overlay only on execution', () => {
    const { result } = setup();
    expect(result.current.overlays).toBeNull();
    act(() => {
      result.current.commands.find((entry) => entry.id === 'invite')?.execute?.();
    });
    expect(result.current.overlays).not.toBeNull();
  });
});
