import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IUpdateBaseShareRo } from '@teable/openapi';
import {
  createBaseShare,
  deleteBaseShare,
  getBaseLevelShare,
  refreshBaseShare,
  updateBaseShare,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Spin } from '@teable/ui-lib';
import { Dialog, DialogContent } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
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
  const { t } = useTranslation(['common']);
  const queryClient = useQueryClient();

  const {
    data: share,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ReactQueryKeys.baseShareBase(baseId),
    queryFn: () =>
      getBaseLevelShare(baseId)
        .then((res) => res.data)
        .catch(() => null),
    // Skip fetch when we know from list there's no base share (isBaseShared === false)
    enabled: isBaseShared !== false,
  });

  const shareUrl = useMemo(() => {
    if (!share) return '';
    return getShareUrl(share.shareId);
  }, [share]);

  const invalidateShareState = () => {
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseShareBase(baseId) });
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseShareList(baseId), exact: true });
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
  };

  const { mutate: createShare, isPending: isCreateLoading } = useMutation({
    mutationFn: () => createBaseShare(baseId, {}),
    onSuccess: (res) => {
      // Optimistic: set share data immediately so UI updates without waiting for refetch
      queryClient.setQueryData(ReactQueryKeys.baseShareBase(baseId), res.data);
      // Background invalidate to sync related queries (share list, base nodes, etc.)
      invalidateShareState();
      toast.success(t('baseShare.createSuccess'));
    },
    onError: () => {
      toast.error(t('baseShare.createFailed'));
    },
  });

  const { mutate: updateShare } = useMutation({
    mutationFn: (data: IUpdateBaseShareRo) => updateBaseShare(baseId, share!.shareId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseShareBase(baseId),
      });
    },
    onError: () => {
      toast.error(t('baseShare.updateFailed'));
    },
  });

  const { mutate: deleteShare, isPending: isDeleteLoading } = useMutation({
    mutationFn: () => deleteBaseShare(baseId, share!.shareId),
    onSuccess: () => {
      // Optimistic: clear share data immediately
      queryClient.setQueryData(ReactQueryKeys.baseShareBase(baseId), null);
      // Refresh share list (drives header share icon) and base list (drives space page icon)
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseShareList(baseId),
        exact: true,
      });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      toast.success(t('baseShare.deleteSuccess'));
    },
    onError: () => {
      toast.error(t('baseShare.deleteFailed'));
    },
  });

  const { mutate: refreshShareFn, isPending: isRefreshLoading } = useMutation({
    mutationFn: () => refreshBaseShare(baseId, share!.shareId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseShareBase(baseId),
      });
      toast.success(t('baseShare.refreshSuccess'));
    },
    onError: () => {
      toast.error(t('baseShare.refreshFailed'));
    },
  });

  const handleUpdateSetting = (data: Record<string, unknown>) => {
    if (!share) return;
    updateShare(data as IUpdateBaseShareRo);
  };

  const permissionOptions = useBaseSharePermissionOptions({
    share,
    onUpdate: handleUpdateSetting,
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
          <span className="truncate text-base font-medium" title={baseName}>
            {baseName}
          </span>
        </div>
      }
      share={share || null}
      shareUrl={shareUrl}
      isCreateLoading={isCreateLoading}
      isDeleteLoading={isDeleteLoading}
      isRefreshLoading={isRefreshLoading}
      permissionOptions={permissionOptions}
      onToggleShare={() => createShare()}
      onUpdateSetting={handleUpdateSetting}
      onDeleteShare={() => deleteShare()}
      onRefreshShare={() => refreshShareFn()}
    />
  );
};
