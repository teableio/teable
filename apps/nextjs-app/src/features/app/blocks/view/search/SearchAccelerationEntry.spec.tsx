import { Role } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import type * as Sdk from '@teable/sdk';
import { AnchorContext, RowCountProvider, ShareViewContext } from '@teable/sdk/context';
import { ConnectionContext } from '@teable/sdk/context/app/ConnectionContext';
import { SearchProvider } from '@teable/sdk/context/query';
import type * as SdkHooks from '@teable/sdk/hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, userEvent, waitFor } from '@/test-utils';
import {
  MemberSearchAccelerationEntry,
  ShareSearchAccelerationEntry,
} from './SearchAccelerationEntry';
import { SearchButton } from './SearchButton';

const api = vi.hoisted(() => ({
  getShareSearchAccelerationStatus: vi.fn(),
  getTableSearchAccelerationStatus: vi.fn(),
  getTablePermission: vi.fn(),
  getSpaceById: vi.fn(),
  setTableSearchAcceleration: vi.fn(),
  getRowCount: vi.fn(),
  getShareViewRowCount: vi.fn(),
}));
vi.mock('@teable/openapi', async (original) => ({ ...(await original<typeof OpenApi>()), ...api }));
const grid = vi.hoisted(() => ({
  shared: false,
  fields: [{ id: 'fld1', name: 'Name' }],
}));
vi.mock('@teable/sdk', async (original) => ({
  ...(await original<typeof Sdk>()),
  useView: () => ({ id: 'viw1', type: 'grid' }),
}));
vi.mock('@teable/sdk/hooks', async (original) => {
  const sdk = await original<typeof SdkHooks>();
  return {
    ...sdk,
    useBase: () => ({
      id: 'bse1',
      spaceId: 'spc1',
      v2Status: { useV2: true },
      searchAccelerationSwitchEnabled: true,
    }),
    useTable: () => (grid.shared ? sdk.useTable() : { id: 'tbl1', name: 'Orders' }),
    useIsAnonymous: () => grid.shared,
    useIsReadOnlyPreview: () => false,
    useBaseId: () => 'bse1',
    useTableId: () => 'tbl1',
    useTablePermission: () => ({ 'table|read': true }),
    useFields: () => grid.fields,
  };
});
vi.mock('@/features/app/hooks/useEnv', () => ({ useEnv: () => ({}) }));
vi.mock('./SearchCountPagination', () => ({ SearchCountPagination: () => null }));
vi.mock('../tool-bar/ToolBarButton', () => ({
  ToolBarButton: ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick}>Search</button>
  ),
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
const member = (
  <MemberSearchAccelerationEntry baseId="bse1" tableId="tbl1" spaceId="spc1" tableName="Orders" />
);
const badge = (state: string) =>
  screen.findByRole('button', { name: new RegExp('state\\.' + state + '$') });

beforeEach(() => {
  vi.resetAllMocks();
  grid.shared = false;
  api.getTablePermission.mockResolvedValue({ data: { table: { 'table|update': true } } });
  api.getSpaceById.mockResolvedValue({ data: { role: Role.Creator } });
  api.getTableSearchAccelerationStatus.mockResolvedValue({
    data: { intentState: 'disabled', serving: false },
  });
});

describe('grid search acceleration status', () => {
  it.each([Role.Owner, Role.Creator])('opens the existing dialog for a space %s', async (role) => {
    api.getSpaceById.mockResolvedValue({ data: { role } });
    render(member);
    await userEvent.click(await badge('disabled'));
    await userEvent.click(await screen.findByText('table:searchAcceleration.configure'));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Orders');
    await userEvent.click(await screen.findByText('table:searchAcceleration.enable'));
    expect(api.setTableSearchAcceleration).toHaveBeenCalledWith('bse1', 'tbl1', { enabled: true });
  });

  it.each([
    [Role.Editor, true],
    [Role.Owner, false],
  ] as const)(
    'shows a contact instruction for role %s with table update %s',
    async (role, update) => {
      api.getSpaceById.mockResolvedValue({ data: { role } });
      api.getTablePermission.mockResolvedValue({ data: { table: { 'table|update': update } } });
      api.getTableSearchAccelerationStatus.mockResolvedValue({
        data: { intentState: 'preparing', serving: false },
      });
      render(member);
      await userEvent.click(await badge('preparing'));
      expect(await screen.findByText('table:searchAcceleration.contactAdmin')).toBeVisible();
      expect(screen.queryByText('table:searchAcceleration.configure')).toBeNull();
    }
  );

  it.each([false, true])(
    'keeps status cached while typing and reopening ordinary search (share=%s)',
    async (shared) => {
      grid.shared = shared;
      api.getShareSearchAccelerationStatus.mockResolvedValue({
        data: { accelerationServing: false },
      });
      const count = shared ? api.getShareViewRowCount : api.getRowCount;
      count.mockResolvedValue({ data: { rowCount: 1 } });
      const toolbar = (open: boolean) => (
        <AnchorContext.Provider value={{ baseId: 'bse1', tableId: 'tbl1', viewId: 'viw1' }}>
          <ShareViewContext.Provider
            value={
              (shared
                ? { shareId: 'shr1', searchAccelerationStatusEnabled: true }
                : {}) as OpenApi.ShareViewGetVo
            }
          >
            <SearchProvider>
              <ConnectionContext.Provider value={{ connected: false }}>
                <RowCountProvider>{open && <SearchButton shareView={shared} />}</RowCountProvider>
              </ConnectionContext.Provider>
            </SearchProvider>
          </ShareViewContext.Provider>
        </AnchorContext.Provider>
      );
      const { rerender } = render(toolbar(true));
      await waitFor(() => expect(count).toHaveBeenCalledTimes(1));
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      await badge('disabled');
      await userEvent.type(screen.getByRole('textbox'), 'needle');
      await waitFor(() =>
        expect(count).toHaveBeenCalledWith(
          shared ? 'shr1' : 'tbl1',
          expect.objectContaining({ search: ['needle', '', true] }),
          expect.anything()
        )
      );
      expect(count).toHaveBeenCalledTimes(2);
      rerender(toolbar(false));
      rerender(toolbar(true));
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      await badge('disabled');
      expect(api.getTableSearchAccelerationStatus).toHaveBeenCalledTimes(shared ? 0 : 1);
      expect(api.getShareSearchAccelerationStatus).toHaveBeenCalledTimes(shared ? 1 : 0);
      expect(count).toHaveBeenCalledTimes(2);
    }
  );

  it.each([true, false])(
    'uses only visible-field share status when serving is %s',
    async (serving) => {
      api.getShareSearchAccelerationStatus.mockResolvedValue({
        data: { accelerationServing: serving },
      });
      const { rerender } = render(<ShareSearchAccelerationEntry shareId="shr1" />);
      await userEvent.click(await badge(serving ? 'enabled' : 'disabled'));
      rerender(<ShareSearchAccelerationEntry shareId="shr1" />);
      expect(api.getShareSearchAccelerationStatus).toHaveBeenCalledTimes(1);
      expect(api.getShareSearchAccelerationStatus).toHaveBeenCalledWith('shr1');
      expect(api.getTableSearchAccelerationStatus).not.toHaveBeenCalled();
      expect(api.getTablePermission).not.toHaveBeenCalled();
      expect(api.getSpaceById).not.toHaveBeenCalled();
      expect(screen.queryByText('table:searchAcceleration.configure')).toBeNull();
    }
  );
});
