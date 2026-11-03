import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Table } from '@teable/sdk/model';
import type { IOperationPreviewDto } from '@teable/v2-contract-http/operationPreview';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableOperation } from './TableOperation';
import { useTableDuplicatePreview } from './useTableDuplicatePreview';

const { post, duplicateTableCheck, duplicateTable, rollout, router } = vi.hoisted(() => ({
  post: vi.fn(),
  duplicateTableCheck: vi.fn(),
  duplicateTable: vi.fn(),
  rollout: { isCanary: false, useV2: false as boolean | undefined, forceV2All: false },
  router: { query: { baseId: 'bseSource' }, push: vi.fn() },
}));
vi.mock('@teable/openapi', () => ({
  getAxios: () => ({ post }),
  duplicateTableCheck,
  duplicateTable,
  SUPPORTEDTYPE: { CSV: 'csv', EXCEL: 'excel' },
}));
vi.mock('@teable/sdk/hooks', () => ({
  useBase: () => ({ isCanary: rollout.isCanary, v2Status: { useV2: rollout.useV2 } }),
  useBasePermission: () => ({ 'table|create': true }),
  useTables: () => [{ id: 'tblSource', name: 'Orders' }],
}));
vi.mock('@/features/app/hooks/useEnv', () => ({
  useEnv: () => ({ forceV2All: rollout.forceV2All }),
}));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ children }: PropsWithChildren) => children }));
vi.mock('../../hooks/useDownLoad', () => ({ useDownload: () => ({}) }));
vi.mock('../import-table', () => ({ TableImport: () => null }));
vi.mock('@/features/app/components/table-delete-confirm-dialog/TableDeleteConfirmDialog', () => ({
  TableDeleteConfirmDialog: () => null,
}));
vi.mock('@teable/ui-lib/base', () => ({
  ConfirmDialog: ({
    open,
    content,
    confirmText,
    confirmDisabled,
    onConfirm,
  }: {
    open: boolean;
    content: ReactNode;
    confirmText: string;
    confirmDisabled?: boolean;
    onConfirm: () => void;
  }) =>
    open ? (
      <div>
        {content}
        <button disabled={confirmDisabled} onClick={onConfirm}>
          {confirmText}
        </button>
      </div>
    ) : null,
}));
vi.mock('@teable/ui-lib/shadcn', () => {
  const Container = ({ children }: PropsWithChildren) => <div>{children}</div>;
  const Button = ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => (
    <button onClick={onClick}>{children}</button>
  );
  return {
    Button,
    DropdownMenu: Container,
    DropdownMenuContent: Container,
    DropdownMenuTrigger: Container,
    DropdownMenuSub: Container,
    DropdownMenuPortal: Container,
    DropdownMenuSubContent: Container,
    DropdownMenuSubTrigger: Container,
    DropdownMenuItem: Button,
    Label: Container,
    Input: () => null,
    Switch: () => null,
  };
});

const blockedPreview: IOperationPreviewDto = {
  operation: 'table.duplicate',
  outcome: 'blocked',
  effects: [],
  blockers: [{ code: 'table.duplicate.v2_cross_space_blocked' }],
  warnings: [],
  coverage: { known: ['cross-space-policy'], unknown: [] },
  complexity: null,
  authorization: 'checked',
  observedAt: '2026-10-27T12:00:00.000Z',
  consistency: 'best-effort',
  requestDigest: `sha256:${'a'.repeat(64)}`,
  implementation: { plannerVersion: 'test-1', executionPath: 'v2' },
};
const table = {
  id: 'tblSource',
  name: 'Orders',
  permission: { 'table|read': true },
} as Table;
const clients: QueryClient[] = [];
const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};
const openDuplicate = () => {
  render(<TableOperation table={table} />, { wrapper: wrapper() });
  fireEvent.click(screen.getByRole('button', { name: 'table:import.menu.duplicate' }));
};
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.resetAllMocks();
  rollout.isCanary = false;
  rollout.useV2 = false;
  rollout.forceV2All = false;
});

describe('table duplicate selected write path', () => {
  it('allows the legacy conversion with its existing check, without calling the v2 policy', async () => {
    duplicateTableCheck.mockResolvedValue({
      data: { affectedFields: [{ fieldId: 'fldLink', fieldName: 'Customer', type: 'link' }] },
    });
    duplicateTable.mockResolvedValue({ data: { id: 'tblCopy' } });
    openDuplicate();
    expect(await screen.findByText('Customer')).toBeInTheDocument();
    expect(screen.getByText('table:crossSpace.duplicateTableDescription')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'table:crossSpace.convertAndDuplicate' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(duplicateTable).toHaveBeenCalledWith('bseSource', 'tblSource', {
        name: 'Orders space:baseModal.copy',
        includeRecords: true,
      })
    );
    expect(duplicateTableCheck).toHaveBeenCalledWith('bseSource', 'tblSource');
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    { useV2: true, isCanary: false, forceV2All: false },
    { useV2: false, isCanary: false, forceV2All: true },
    { useV2: undefined, isCanary: true, forceV2All: false },
  ])('blocks the actual v2 path, including forced rollout: %j', async (flags) => {
    Object.assign(rollout, flags);
    post.mockResolvedValue({ data: { ok: true, data: blockedPreview } });
    openDuplicate();
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'common:actions.duplicate' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.duplicate' }));
    expect(duplicateTable).not.toHaveBeenCalled();
    expect(duplicateTableCheck).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      '/v2/operations/preview',
      {
        operation: 'table.duplicate',
        input: {
          baseId: 'bseSource',
          tableId: 'tblSource',
          name: 'Orders space:baseModal.copy',
          includeRecords: true,
        },
        options: { detail: 'full' },
      },
      expect.anything()
    );
  });

  it('keeps authoritative v1 status ahead of the canary hint', async () => {
    rollout.isCanary = true;
    duplicateTableCheck.mockResolvedValue({ data: { affectedFields: [] } });
    openDuplicate();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'common:actions.duplicate' })).toBeEnabled()
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps the legacy confirmation disabled when the conversion check fails', async () => {
    duplicateTableCheck.mockRejectedValue(new Error('conversion check failed'));
    const { result } = renderHook(
      () =>
        useTableDuplicatePreview(
          'bseSource',
          'tblSource',
          { name: 'Orders copy', includeRecords: true },
          true
        ),
      { wrapper: wrapper() }
    );
    await waitFor(() =>
      expect(
        clients.at(-1)?.getQueryState(['duplicate-table-check', 'bseSource', 'tblSource'])?.status
      ).toBe('error')
    );
    expect(result.current.canConfirm).toBe(false);
  });

  it('keeps the legacy duplicate dialog gated after the conversion check errors', async () => {
    duplicateTableCheck.mockRejectedValue(new Error('conversion check failed'));
    openDuplicate();
    await waitFor(() =>
      expect(
        clients.at(-1)?.getQueryState(['duplicate-table-check', 'bseSource', 'tblSource'])?.status
      ).toBe('error')
    );

    const confirm = screen.getByRole('button', { name: 'common:actions.duplicate' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(duplicateTable).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps v2 HTTP errors disabled and never falls back to the legacy check', async () => {
    rollout.useV2 = true;
    post.mockRejectedValue(new Error('permission denied'));
    openDuplicate();
    expect(await screen.findByRole('alert')).toHaveTextContent('operationPreview.failed');
    expect(screen.getByRole('button', { name: 'common:actions.duplicate' })).toBeDisabled();
    expect(duplicateTableCheck).not.toHaveBeenCalled();
    expect(duplicateTable).not.toHaveBeenCalled();
  });
});
