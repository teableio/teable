import { HttpError } from '@teable/core';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaleTableNotice, useStaleTableRecovery } from './use-table-error-handler';

const mocks = vi.hoisted(() => ({
  getTableList: vi.fn(),
  getTableById: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
  tables: [{ id: 'other', baseId: 'base', name: 'Other' }],
  router: { asPath: '', query: {} as Record<string, string> },
}));
vi.mock('@teable/openapi', () => ({
  getTableList: mocks.getTableList,
  getTableById: mocks.getTableById,
}));
vi.mock('@teable/sdk/hooks', () => ({
  useTables: () => mocks.tables,
  useIsReadOnlyPreview: () => false,
  useConnection: () => ({}),
}));
vi.mock('@teable/ui-lib/shadcn/ui/sonner', () => ({ toast: { info: mocks.toast } }));
vi.mock('next/router', () => ({
  useRouter: () => ({ ...mocks.router, replace: mocks.replace }),
}));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/app/context/ShareContext', () => ({ useShareUrlPrefix: () => undefined }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.router.query = {};
  mocks.getTableList.mockResolvedValue({ data: mocks.tables });
});
afterEach(cleanup);

const confirm = async (id: string) => {
  mocks.router.asPath = `/base/base/table/${id}`;
  await act(async () => {
    renderHook(() => useStaleTableRecovery('base', id));
  });
};

describe('table list absence confirmation', () => {
  it('keeps the open table when ready-only lists omit a pending table', async () => {
    mocks.getTableById.mockRejectedValue(
      new HttpError('Updating', 503, { domainCode: 'table.provision_pending' })
    );
    await confirm('pending');
    expect(mocks.getTableById).toHaveBeenCalledWith('base', 'pending');
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('keeps the open table on a transient confirmation failure', async () => {
    mocks.getTableById.mockRejectedValue(new HttpError('Unavailable', 503));
    await confirm('transient');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('recovers to the next table only after confirmed deletion', async () => {
    mocks.getTableById.mockRejectedValue(new HttpError('Missing', 404));
    await confirm('deleted');
    expect(mocks.replace).toHaveBeenCalledWith('/base/base/table/other');
    expect(mocks.toast).toHaveBeenCalledWith('table:table.deletedRecovered.title', {
      id: 'stale-table-recovery',
      description: 'table:table.deletedRecovered.description',
    });
  });

  it('leaves a table the role now hides without calling it deleted', async () => {
    mocks.getTableById.mockRejectedValue(new HttpError('Restricted', 403));
    await confirm('hidden');
    expect(mocks.replace).toHaveBeenCalledWith('/base/base/table/other');
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe('StaleTableNotice', () => {
  it('says once that the linked table did not open, then strips the marker', async () => {
    mocks.router.asPath = '/base/base/table/other/viwX?staleTableId=gone&recordId=rec1';
    mocks.router.query = { staleTableId: 'gone' };
    await act(async () => {
      render(<StaleTableNotice />);
    });

    // raised a tick later, once the app's Toaster has subscribed
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1));
    expect(mocks.toast).toHaveBeenCalledWith('table:table.unavailableRecovered.title', {
      id: 'stale-table-recovery',
      description: 'table:table.unavailableRecovered.description',
    });
    expect(mocks.replace).toHaveBeenCalledWith(
      '/base/base/table/other/viwX?recordId=rec1',
      undefined,
      {
        shallow: true,
      }
    );
  });

  it('stays silent on an ordinary page load', async () => {
    mocks.router.asPath = '/base/base/table/other/viwX';
    await act(async () => {
      render(<StaleTableNotice />);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
