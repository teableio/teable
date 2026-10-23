import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as OpenApi from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, userEvent, waitFor } from '@/test-utils';
import { BaseShareDialog } from './BaseShareDialog';

const api = vi.hoisted(() => ({
  getBaseLevelShare: vi.fn(),
  createBaseShare: vi.fn(),
  updateBaseShare: vi.fn(),
  refreshBaseShare: vi.fn(),
  deleteBaseShare: vi.fn(),
}));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  ...api,
}));
vi.mock('@/features/app/hooks/useShortLink', () => ({
  useShortLink: () => ({ shortUrl: 'https://teable.test/s/fixture', isFallback: false }),
}));

const share: OpenApi.IBaseShareVo = {
  baseId: 'bseFixture',
  shareId: 'shrFixture',
  password: false,
  nodeId: null,
  allowSave: null,
  allowCopy: null,
  allowEdit: null,
  enabled: true,
};

beforeEach(() => vi.resetAllMocks());

describe('BaseShareDialog on a project the list still reports as unshared', () => {
  it('shows the permission picked right after the share was enabled', async () => {
    api.createBaseShare.mockResolvedValue({ data: share });
    api.updateBaseShare.mockResolvedValue({
      data: { ...share, allowSave: true, allowEdit: false },
    });
    const user = userEvent.setup();
    render(
      <BaseShareDialog
        baseId="bseFixture"
        baseName="Fixture"
        isBaseShared={false}
        open
        onOpenChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole('switch', { name: 'baseShare.shareToWeb' }));
    await user.click(await screen.findByRole('button', { name: 'baseShare.linkHolderCanView' }));
    await user.click(await screen.findByRole('menuitem', { name: /linkHolderCanCopyAndSave/ }));

    expect(api.updateBaseShare).toHaveBeenCalledWith('bseFixture', 'shrFixture', {
      allowSave: true,
      allowEdit: false,
    });
    expect(
      await screen.findByRole('button', { name: 'baseShare.linkHolderCanCopyAndSave' })
    ).toBeInTheDocument();
    expect(api.getBaseLevelShare).not.toHaveBeenCalled();
  });

  it('sends permission changes one at a time so the last pick wins', async () => {
    api.createBaseShare.mockResolvedValue({ data: share });
    const respond: Array<(vo: OpenApi.IBaseShareVo) => void> = [];
    api.updateBaseShare.mockImplementation(
      () => new Promise((resolve) => respond.push((vo) => resolve({ data: vo })))
    );
    const user = userEvent.setup();
    render(
      <BaseShareDialog
        baseId="bseFixture"
        baseName="Fixture"
        isBaseShared={false}
        open
        onOpenChange={vi.fn()}
      />
    );
    await user.click(screen.getByRole('switch', { name: 'baseShare.shareToWeb' }));

    await user.click(await screen.findByRole('button', { name: 'baseShare.linkHolderCanView' }));
    await user.click(await screen.findByRole('menuitem', { name: /linkHolderCanEdit/ }));
    expect(api.updateBaseShare).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'baseShare.linkHolderCanView' }));
    await user.click(await screen.findByRole('menuitem', { name: /linkHolderCanCopyAndSave/ }));
    expect(api.updateBaseShare).toHaveBeenCalledTimes(1);

    respond[0]({ ...share, allowEdit: true });
    await waitFor(() => expect(api.updateBaseShare).toHaveBeenCalledTimes(2));
    expect(api.updateBaseShare).toHaveBeenLastCalledWith('bseFixture', 'shrFixture', {
      allowSave: true,
      allowEdit: false,
    });
    respond[1]({ ...share, allowSave: true });
    expect(
      await screen.findByRole('button', { name: 'baseShare.linkHolderCanCopyAndSave' })
    ).toBeInTheDocument();
  });

  it('fetches the existing share when the caller does not know whether the project is shared', async () => {
    api.getBaseLevelShare.mockResolvedValue({ data: { ...share, allowEdit: true } });
    render(<BaseShareDialog baseId="bseFixture" baseName="Fixture" open onOpenChange={vi.fn()} />);

    expect(await screen.findByRole('switch', { name: 'baseShare.shareToWeb' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'baseShare.linkHolderCanEdit' })).toBeInTheDocument();
  });
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const openExistingShare = async () => {
  api.getBaseLevelShare.mockResolvedValue({ data: share });
  const user = userEvent.setup();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <BaseShareDialog
        baseId="bseFixture"
        baseName="Fixture"
        isBaseShared
        open
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>
  );
  await screen.findByRole('button', { name: 'baseShare.linkHolderCanView' });
  return { user, queryClient, ...result };
};

const chooseEditPermission = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'baseShare.linkHolderCanView' }));
  await user.click(await screen.findByRole('menuitem', { name: /linkHolderCanEdit/ }));
};

const closeShare = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('switch', { name: 'baseShare.shareToWeb' }));
  await user.click(await screen.findByRole('button', { name: 'common:actions.confirm' }));
};

describe('BaseShareDialog queued writes', () => {
  it('uses the new ID for an update queued behind a refresh', async () => {
    const refresh = deferred<{ data: OpenApi.IBaseShareVo }>();
    const refreshed = { ...share, shareId: 'shrRefreshed' };
    api.refreshBaseShare.mockReturnValue(refresh.promise);
    api.updateBaseShare.mockResolvedValue({ data: { ...refreshed, allowEdit: true } });
    const { user } = await openExistingShare();

    await user.click(screen.getByRole('button', { name: 'baseShare.refreshLink' }));
    await chooseEditPermission(user);
    expect(api.updateBaseShare).not.toHaveBeenCalled();

    await act(async () => refresh.resolve({ data: refreshed }));
    await waitFor(() =>
      expect(api.updateBaseShare).toHaveBeenCalledWith('bseFixture', 'shrRefreshed', {
        allowEdit: true,
        allowSave: false,
      })
    );
    expect(
      await screen.findByRole('button', { name: 'baseShare.linkHolderCanEdit' })
    ).toBeInTheDocument();
  });

  it('waits for an update before deleting, then allows sharing again', async () => {
    const update = deferred<{ data: OpenApi.IBaseShareVo }>();
    api.updateBaseShare.mockReturnValue(update.promise);
    api.deleteBaseShare.mockResolvedValue({ data: undefined });
    const { user } = await openExistingShare();

    await chooseEditPermission(user);
    await closeShare(user);
    expect(api.deleteBaseShare).not.toHaveBeenCalled();

    await act(async () => update.resolve({ data: { ...share, allowEdit: true } }));
    await waitFor(() => expect(api.deleteBaseShare).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'baseShare.shareToWeb' })).not.toBeChecked()
    );

    api.createBaseShare.mockResolvedValue({ data: { ...share, shareId: 'shrRecreated' } });
    await user.click(screen.getByRole('switch', { name: 'baseShare.shareToWeb' }));
    await screen.findByRole('button', { name: 'baseShare.linkHolderCanView' });
    api.updateBaseShare.mockResolvedValue({
      data: { ...share, shareId: 'shrRecreated', allowEdit: true },
    });
    await chooseEditPermission(user);
    await waitFor(() =>
      expect(api.updateBaseShare).toHaveBeenLastCalledWith('bseFixture', 'shrRecreated', {
        allowEdit: true,
        allowSave: false,
      })
    );
    await screen.findByRole('button', { name: 'baseShare.linkHolderCanEdit' });
  });

  it('uses the new ID for a delete queued behind a refresh', async () => {
    const refresh = deferred<{ data: OpenApi.IBaseShareVo }>();
    api.refreshBaseShare.mockReturnValue(refresh.promise);
    api.deleteBaseShare.mockResolvedValue({ data: undefined });
    const { user } = await openExistingShare();

    await user.click(screen.getByRole('button', { name: 'baseShare.refreshLink' }));
    await closeShare(user);
    expect(api.deleteBaseShare).not.toHaveBeenCalled();

    await act(async () => refresh.resolve({ data: { ...share, shareId: 'shrRefreshed' } }));
    await waitFor(() =>
      expect(api.deleteBaseShare).toHaveBeenCalledWith('bseFixture', 'shrRefreshed')
    );
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'baseShare.shareToWeb' })).not.toBeChecked()
    );
  });

  it('skips updates and refreshes queued after a successful delete', async () => {
    const deletion = deferred<{ data: undefined }>();
    api.deleteBaseShare.mockReturnValue(deletion.promise);
    const { user } = await openExistingShare();

    await closeShare(user);
    await chooseEditPermission(user);
    await user.click(screen.getByRole('button', { name: 'baseShare.refreshLink' }));
    expect(api.updateBaseShare).not.toHaveBeenCalled();
    expect(api.refreshBaseShare).not.toHaveBeenCalled();

    await act(async () => deletion.resolve({ data: undefined }));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'baseShare.shareToWeb' })).not.toBeChecked()
    );
    expect(api.updateBaseShare).not.toHaveBeenCalled();
    expect(api.refreshBaseShare).not.toHaveBeenCalled();
  });

  it('continues queued updates if refreshing fails', async () => {
    const refresh = deferred<{ data: OpenApi.IBaseShareVo }>();
    api.refreshBaseShare.mockReturnValue(refresh.promise);
    api.updateBaseShare.mockResolvedValue({ data: { ...share, allowEdit: true } });
    const { user } = await openExistingShare();

    await user.click(screen.getByRole('button', { name: 'baseShare.refreshLink' }));
    await chooseEditPermission(user);
    expect(api.updateBaseShare).not.toHaveBeenCalled();

    await act(async () => refresh.reject(new Error('Refresh failed')));
    await waitFor(() =>
      expect(api.updateBaseShare).toHaveBeenCalledWith('bseFixture', 'shrFixture', {
        allowEdit: true,
        allowSave: false,
      })
    );
    expect(
      await screen.findByRole('button', { name: 'baseShare.linkHolderCanEdit' })
    ).toBeInTheDocument();
  });

  it('continues queued updates if deleting fails', async () => {
    const deletion = deferred<{ data: undefined }>();
    api.deleteBaseShare.mockReturnValue(deletion.promise);
    api.updateBaseShare.mockResolvedValue({ data: { ...share, allowEdit: true } });
    const { user } = await openExistingShare();

    await closeShare(user);
    await chooseEditPermission(user);
    expect(api.updateBaseShare).not.toHaveBeenCalled();

    await act(async () => deletion.reject(new Error('Delete failed')));
    expect(
      await screen.findByRole('button', { name: 'baseShare.linkHolderCanEdit' })
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'baseShare.shareToWeb' })).toBeChecked();
  });

  it.each(['before', 'during'] as const)(
    'discards stale refetches started %s a setting update',
    async (timing) => {
      const update = deferred<{ data: OpenApi.IBaseShareVo }>();
      const staleRead = deferred<{ data: OpenApi.IBaseShareVo }>();
      api.updateBaseShare.mockReturnValue(update.promise);
      const { user, queryClient } = await openExistingShare();
      const queryKey = ReactQueryKeys.baseShareBase(share.baseId);
      api.getBaseLevelShare.mockReturnValue(staleRead.promise);
      let refetch!: Promise<void>;
      const startRefetch = async () => {
        await act(async () => {
          refetch = queryClient.refetchQueries({ queryKey });
        });
        expect(api.getBaseLevelShare).toHaveBeenCalledTimes(2);
      };

      if (timing === 'before') await startRefetch();
      await chooseEditPermission(user);
      if (timing === 'during') await startRefetch();

      const updated = { ...share, allowEdit: true };
      await act(async () => update.resolve({ data: updated }));
      await screen.findByRole('button', { name: 'baseShare.linkHolderCanEdit' });
      await act(async () => {
        staleRead.resolve({ data: share });
        await refetch;
      });
      expect(queryClient.getQueryData(queryKey)).toEqual(updated);
      expect(
        screen.getByRole('button', { name: 'baseShare.linkHolderCanEdit' })
      ).toBeInTheDocument();
    }
  );

  it('preserves the write queue when the dialog is remounted', async () => {
    const refresh = deferred<{ data: OpenApi.IBaseShareVo }>();
    const refreshed = { ...share, shareId: 'shrRefreshed' };
    api.refreshBaseShare.mockReturnValue(refresh.promise);
    api.updateBaseShare.mockResolvedValue({ data: { ...refreshed, allowEdit: true } });
    const { user, queryClient, rerender } = await openExistingShare();
    await user.click(screen.getByRole('button', { name: 'baseShare.refreshLink' }));

    rerender(
      <QueryClientProvider client={queryClient}>
        <BaseShareDialog
          key="reopened"
          baseId="bseFixture"
          baseName="Fixture"
          isBaseShared
          open
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>
    );
    await screen.findByRole('button', { name: 'baseShare.linkHolderCanView' });
    await chooseEditPermission(user);
    expect(api.updateBaseShare).not.toHaveBeenCalled();

    await act(async () => refresh.resolve({ data: refreshed }));
    await waitFor(() =>
      expect(api.updateBaseShare).toHaveBeenCalledWith('bseFixture', 'shrRefreshed', {
        allowEdit: true,
        allowSave: false,
      })
    );
    await screen.findByRole('button', { name: 'baseShare.linkHolderCanEdit' });
  });
});
