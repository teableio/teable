import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IBaseShareVo, IUpdateBaseShareRo } from '@teable/openapi';
import {
  createBaseShare,
  deleteBaseShare,
  getBaseLevelShare,
  refreshBaseShare,
  ShortLinkType,
  updateBaseShare,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useContentDir } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib';
import { Dialog, DialogContent } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useOrigin } from '@/features/app/hooks/useOrigin';
import { useShortLink } from '@/features/app/hooks/useShortLink';
import { BaseShareContent } from './BaseShareContent';
import { getShareUrl } from './NodeShareContent';
import { useBaseSharePermissionOptions } from './useBaseSharePermissionOptions';

export const BaseShareDialog = ({
  baseId,
  baseName,
  isBaseShared,
  open,
  onOpenChange,
}: {
  baseId: string;
  baseName: string;
  isBaseShared?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-full p-5 md:w-[420px]">
        <BaseShareDialogContent baseId={baseId} baseName={baseName} isBaseShared={isBaseShared} />
      </DialogContent>
    </Dialog>
  );
};

const BaseShareDialogContent = ({
  baseId,
  baseName,
  isBaseShared,
}: {
  baseId: string;
  baseName: string;
  isBaseShared?: boolean;
}) => {
  const contentDir = useContentDir();
  const { t } = useTranslation(['common']);
  const queryClient = useQueryClient();
  const shareKey = ReactQueryKeys.baseShareBase(baseId);
  // Keep all writes ordered, including across dialog remounts using the same QueryClient.
  const writeScope = { id: `base-share-write-${baseId}` };

  const getCurrentShare = async () => {
    await queryClient.cancelQueries({ queryKey: shareKey, exact: true });
    // A preceding refresh/delete may have changed the share before React renders again.
    return queryClient.getQueryData<IBaseShareVo | null>(shareKey);
  };

  const setShare = async (value: IBaseShareVo | null) => {
    // A focus/remount refetch can start during a write. Discard it before publishing the result.
    await queryClient.cancelQueries({ queryKey: shareKey, exact: true });
    queryClient.setQueryData(shareKey, value);
  };

  const {
    data: share,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: shareKey,
    queryFn: () =>
      getBaseLevelShare(baseId)
        .then((res) => res.data)
        .catch(() => null),
    // Skip fetch when we know from list there's no base share (isBaseShared === false)
    enabled: isBaseShared !== false,
  });

  // Prefer the short URL for display/copy/QR code; only fall back to the long
  // URL when short link creation failed (empty while loading to avoid a flash)
  const { shortUrl, isFallback } = useShortLink(
    share ? { type: ShortLinkType.BaseShare, resourceId: share.shareId } : undefined
  );
  const origin = useOrigin();
  const shareUrl = useMemo(() => {
    if (!share) return '';
    return shortUrl ?? (isFallback ? getShareUrl(share.shareId, origin) : '');
  }, [share, shortUrl, isFallback, origin]);
  // Embed always uses the long URL: the iframe lives on third-party pages, so
  // there is no reason to go through the short-link redirect
  const embedUrl = share ? getShareUrl(share.shareId, origin) : '';

  const invalidateShareState = () => {
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseShareList(baseId), exact: true });
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
  };

  const { mutate: createShare, isPending: isCreateLoading } = useMutation({
    scope: writeScope,
    mutationFn: async () => {
      await queryClient.cancelQueries({ queryKey: shareKey, exact: true });
      return createBaseShare(baseId, {});
    },
    onSuccess: async (res) => {
      await setShare(res.data);
      // Background invalidate to sync related queries (share list, base nodes, etc.)
      invalidateShareState();
      toast.success(t('baseShare.createSuccess'));
    },
    onError: () => {
      toast.error(t('baseShare.createFailed'));
    },
  });

  const { mutateAsync: updateShare, isPending: isUpdateLoading } = useMutation({
    scope: writeScope,
    mutationFn: async (data: IUpdateBaseShareRo) => {
      const currentShare = await getCurrentShare();
      // Settings queued after deletion must not target a removed share.
      return currentShare ? updateBaseShare(baseId, currentShare.shareId, data) : null;
    },
    // The caller's isBaseShared hint can leave the share query disabled, and invalidate skips those
    onSuccess: async (res) => {
      if (res) await setShare(res.data);
    },
    onError: () => {
      toast.error(t('baseShare.updateFailed'));
    },
  });

  const { mutate: deleteShare, isPending: isDeleteLoading } = useMutation({
    scope: writeScope,
    mutationFn: async () => {
      const currentShare = await getCurrentShare();
      if (currentShare) await deleteBaseShare(baseId, currentShare.shareId);
    },
    onSuccess: async () => {
      await setShare(null);
      // Refresh share list (drives header share icon) and base list (drives space page icon)
      invalidateShareState();
      toast.success(t('baseShare.deleteSuccess'));
    },
    onError: () => {
      toast.error(t('baseShare.deleteFailed'));
    },
  });

  const { mutate: refreshShareFn, isPending: isRefreshLoading } = useMutation({
    scope: writeScope,
    mutationFn: async () => {
      const currentShare = await getCurrentShare();
      return currentShare ? refreshBaseShare(baseId, currentShare.shareId) : null;
    },
    onSuccess: async (res) => {
      if (!res) return;
      await setShare(res.data);
      toast.success(t('baseShare.refreshSuccess'));
    },
    onError: () => {
      toast.error(t('baseShare.refreshFailed'));
    },
  });

  // Resolves whether the update was saved; failures are already toasted by onError
  const handleUpdateSetting = async (data: Record<string, unknown>) => {
    if (!share) return false;
    return updateShare(data as IUpdateBaseShareRo).then(
      (res) => Boolean(res),
      () => false
    );
  };

  const permissionOptions = useBaseSharePermissionOptions({
    share,
    onUpdate: (data) => void handleUpdateSetting(data),
  });

  // Show loading for initial fetch, or when refetching after create (share not yet available)
  if (isLoading || (isFetching && !share)) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spin className="size-6" />
      </div>
    );
  }

  return (
    <BaseShareContent
      header={
        <div className="flex w-full items-center gap-2">
          <span className="text-base font-medium">{t('baseShare.shareTitle')}</span>
          <span dir={contentDir} className="truncate text-base font-medium" title={baseName}>
            {baseName}
          </span>
        </div>
      }
      share={share || null}
      shareUrl={shareUrl}
      embedUrl={embedUrl}
      isCreateLoading={isCreateLoading}
      isDeleteLoading={isDeleteLoading}
      isRefreshLoading={isRefreshLoading}
      isUpdateLoading={isUpdateLoading}
      permissionOptions={permissionOptions}
      onToggleShare={() => createShare()}
      onUpdateSetting={handleUpdateSetting}
      onDeleteShare={() => deleteShare()}
      onRefreshShare={() => refreshShareFn()}
    />
  );
};
