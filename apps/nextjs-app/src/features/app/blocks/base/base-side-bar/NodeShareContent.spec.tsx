import { useQuery } from '@tanstack/react-query';
import type * as OpenApi from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type * as SdkHooks from '@teable/sdk/hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, userEvent, waitFor } from '@/test-utils';
import type { TreeItemData } from '../base-node/hooks';
import { NodeShareContent } from './NodeShareContent';

const api = vi.hoisted(() => ({
  listBaseShare: vi.fn(),
  getBaseShareByNodeId: vi.fn(),
  createBaseShare: vi.fn(),
  updateBaseShare: vi.fn(),
  refreshBaseShare: vi.fn(),
  deleteBaseShare: vi.fn(),
}));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  ...api,
}));
vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkHooks>()),
  useBasePermission: () => ({ 'base|update': true }),
}));
vi.mock('@/features/app/hooks/useShortLink', () => ({
  useShortLink: () => ({ shortUrl: 'https://teable.test/s/fixture', isFallback: false }),
}));
vi.mock('./BaseNodeShareIndicator', () => ({
  useSharedNodeIds: () => {
    const { data } = useQuery({
      queryKey: ReactQueryKeys.baseShareList('bseFixture'),
      queryFn: () => api.listBaseShare('bseFixture').then((res: { data: unknown }) => res.data),
    });
    const list = (data ?? []) as Array<{ nodeId: string | null }>;
    return {
      sharedNodeIds: new Set(list.map((s) => s.nodeId).filter(Boolean)),
      isBaseShared: false,
    };
  },
}));

const share: OpenApi.IBaseShareVo = {
  baseId: 'bseFixture',
  shareId: 'shrFixture',
  password: false,
  nodeId: 'bnoFolder',
  allowSave: null,
  allowCopy: null,
  allowEdit: null,
  enabled: true,
};

const node = {
  id: 'bnoFolder',
  resourceType: BaseNodeResourceType.Folder,
  resourceId: 'bfdFolder',
  resourceMeta: { name: 'New folder' },
} as unknown as TreeItemData;

beforeEach(() => vi.resetAllMocks());

describe('NodeShareContent create share', () => {
  it('shows the share as enabled as soon as creation succeeds, without allowing a second create', async () => {
    api.listBaseShare.mockResolvedValueOnce({ data: [] });
    // The follow-up list refetch is slow (the ~2s gap in the report)
    api.listBaseShare.mockReturnValue(new Promise(() => {}));
    api.getBaseShareByNodeId.mockResolvedValue({ data: share });
    api.createBaseShare.mockResolvedValue({ data: share });
    const user = userEvent.setup();
    render(<NodeShareContent baseId="bseFixture" nodeId="bnoFolder" node={node} hideHeader />);

    await user.click(await screen.findByRole('switch', { name: 'baseShare.shareToWeb' }));

    expect(await screen.findByRole('switch', { name: 'baseShare.shareToWeb' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'baseShare.linkHolderCanView' })).toBeInTheDocument();
    expect(api.createBaseShare).toHaveBeenCalledTimes(1);
  });

  describe('acting right after creation while the share list is still stale', () => {
    const createWithStaleList = async () => {
      api.listBaseShare.mockResolvedValueOnce({ data: [] });
      api.listBaseShare.mockReturnValue(new Promise(() => {}));
      api.createBaseShare.mockResolvedValue({ data: share });
      const user = userEvent.setup();
      render(<NodeShareContent baseId="bseFixture" nodeId="bnoFolder" node={node} hideHeader />);
      await user.click(await screen.findByRole('switch', { name: 'baseShare.shareToWeb' }));
      await screen.findByRole('button', { name: 'baseShare.linkHolderCanView' });
      return user;
    };

    it('shows the updated permission', async () => {
      api.updateBaseShare.mockResolvedValue({ data: { ...share, allowEdit: true } });
      const user = await createWithStaleList();

      await user.click(screen.getByRole('button', { name: 'baseShare.linkHolderCanView' }));
      await user.click(await screen.findByRole('menuitem', { name: /linkHolderCanEdit/ }));

      expect(
        await screen.findByRole('button', { name: 'baseShare.linkHolderCanEdit' })
      ).toBeInTheDocument();
    });

    it('uses the refreshed share id for later writes', async () => {
      api.refreshBaseShare.mockResolvedValue({ data: { ...share, shareId: 'shrRefreshed' } });
      api.updateBaseShare.mockResolvedValue({
        data: { ...share, shareId: 'shrRefreshed', allowEdit: true },
      });
      const user = await createWithStaleList();

      await user.click(screen.getByRole('button', { name: 'baseShare.refreshLink' }));
      await waitFor(() => expect(api.refreshBaseShare).toHaveBeenCalledTimes(1));
      await user.click(screen.getByRole('button', { name: 'baseShare.linkHolderCanView' }));
      await user.click(await screen.findByRole('menuitem', { name: /linkHolderCanEdit/ }));

      await waitFor(() =>
        expect(api.updateBaseShare).toHaveBeenCalledWith(
          'bseFixture',
          'shrRefreshed',
          expect.anything()
        )
      );
    });

    it('keeps the share off when an update response arrives after a delete', async () => {
      let resolveUpdate!: (value: { data: OpenApi.IBaseShareVo }) => void;
      api.updateBaseShare.mockReturnValue(
        new Promise((resolve) => {
          resolveUpdate = resolve;
        })
      );
      api.deleteBaseShare.mockResolvedValue({ data: undefined });
      const user = await createWithStaleList();

      await user.click(screen.getByRole('button', { name: 'baseShare.linkHolderCanView' }));
      await user.click(await screen.findByRole('menuitem', { name: /linkHolderCanEdit/ }));
      await user.click(screen.getByRole('switch', { name: 'baseShare.shareToWeb' }));
      await user.click(await screen.findByRole('button', { name: 'common:actions.confirm' }));
      expect(api.deleteBaseShare).not.toHaveBeenCalled();

      await act(async () => resolveUpdate({ data: { ...share, allowEdit: true } }));

      await waitFor(() => expect(api.deleteBaseShare).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByRole('switch', { name: 'baseShare.shareToWeb' })).not.toBeChecked()
      );
      expect(screen.queryByRole('button', { name: 'baseShare.linkHolderCanEdit' })).toBeNull();
    });

    it('turns the switch off after deleting', async () => {
      api.deleteBaseShare.mockResolvedValue({ data: undefined });
      const user = await createWithStaleList();

      await user.click(screen.getByRole('switch', { name: 'baseShare.shareToWeb' }));
      await user.click(await screen.findByRole('button', { name: 'common:actions.confirm' }));

      await waitFor(() =>
        expect(screen.getByRole('switch', { name: 'baseShare.shareToWeb' })).not.toBeChecked()
      );
      expect(screen.queryByRole('button', { name: 'baseShare.linkHolderCanView' })).toBeNull();
    });
  });

  it('keeps the advanced options collapsed until the toggle is opened', async () => {
    api.listBaseShare.mockResolvedValue({ data: [share] });
    api.getBaseShareByNodeId.mockResolvedValue({ data: share });
    const user = userEvent.setup();
    render(<NodeShareContent baseId="bseFixture" nodeId="bnoFolder" node={node} hideHeader />);

    const advanced = await screen.findByRole('button', { name: 'baseShare.advanced' });
    expect(screen.queryByRole('switch', { name: 'baseShare.allowCopyData' })).toBeNull();

    await user.click(advanced);
    expect(screen.getByRole('switch', { name: 'baseShare.allowCopyData' })).toBeInTheDocument();
  });
});
