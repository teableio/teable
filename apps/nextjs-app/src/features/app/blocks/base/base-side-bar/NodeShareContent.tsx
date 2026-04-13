import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Qrcode } from '@teable/icons';
import type {
  IBaseNodeAppResourceMeta,
  ICreateBaseShareRo,
  IUpdateBaseShareRo,
} from '@teable/openapi';
import {
  BaseNodeResourceType,
  createBaseShare,
  deleteBaseShare,
  getBaseShareByNodeId,
  refreshBaseShare,
  updateBaseShare,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Spin } from '@teable/ui-lib';
import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { useMemo, useState } from 'react';
import { useAppPublishContext } from '@/features/app/blocks/table/table-header/publish-base/AppPublishContext';
import { CopyButton } from '@/features/app/components/CopyButton';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { BaseNodeResourceIconMap, getNodeIcon, getNodeName } from '../base-node/hooks';
import type { TreeItemData } from '../base-node/hooks';
import { useSharedNodeIds } from './BaseNodeShareIndicator';
import { BaseShareContent } from './BaseShareContent';
import { useBaseSharePermissionOptions } from './useBaseSharePermissionOptions';

export const getShareUrl = (shareId: string) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.teable.ai';
  return `${origin}/share/${shareId}/base`;
};

export const NodeShareHeader = ({ node }: { node: TreeItemData }) => {
  const { t } = useTranslation(['common', 'table']);
  const nodeName = getNodeName(node);
  const nodeIcon = getNodeIcon(node);
  const NodeTypeIcon = BaseNodeResourceIconMap[node.resourceType];

  return (
    <div className="flex w-full items-center gap-2">
      <span className="shrink-0 text-base font-medium">{t('table:baseShare.shareTitle')}</span>
      <span className="shrink-0">
        {nodeIcon ? (
          <Emoji emoji={nodeIcon} size={16} className="size-4" />
        ) : (
          NodeTypeIcon && <NodeTypeIcon className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className="truncate text-base font-medium" title={nodeName}>
        {nodeName}
      </span>
    </div>
  );
};

const AppNodeShareContent = ({
  node,
  nodeId,
  baseId,
  hideHeader,
}: {
  node: TreeItemData;
  nodeId: string;
  baseId: string;
  hideHeader?: boolean;
}) => {
  const { t } = useTranslation(['common', 'table']);
  const queryClient = useQueryClient();
  const { publishApp } = useAppPublishContext();
  const [isPublishing, setIsPublishing] = useState(false);

  const appPublicUrl = (node.resourceMeta as IBaseNodeAppResourceMeta)?.publicUrl;

  const handlePublishApp = async () => {
    if (!publishApp) return;

    setIsPublishing(true);
    try {
      await publishApp({
        nodeId,
        name: (node.resourceMeta as IBaseNodeAppResourceMeta)?.name || '',
        resourceId: node.resourceId,
      });
      queryClient.invalidateQueries({ queryKey: ['baseNodeTree', baseId] });
      toast.success(t('table:baseShare.publishSuccess'));
    } catch {
      toast.error(t('table:baseShare.publishFailed'));
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-4 py-4">
      {!hideHeader && <NodeShareHeader node={node} />}

      {appPublicUrl ? (
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-semibold">{t('table:baseShare.appPublicLink')}</Label>
          <div className="flex items-center gap-2">
            <div className="flex h-9 min-w-0 flex-1 items-center rounded-md border bg-card p-2 pl-3">
              <span className="truncate text-sm text-muted-foreground">{appPublicUrl}</span>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="size-9 shrink-0 p-0"
                    variant="outline"
                    onClick={() => window.open(appPublicUrl, '_blank')}
                  >
                    <ArrowUpRight className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('table:baseShare.openLink')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0">
                  <Qrcode className="size-4 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="size-48 bg-white p-2">
                <QRCodeSVG value={appPublicUrl} className="size-full" />
              </PopoverContent>
            </Popover>
            <CopyButton text={appPublicUrl} variant="outline" size="icon" className="shrink-0" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-6">
          <p className="text-center text-sm text-muted-foreground">
            {t('table:baseShare.appNotPublished')}
          </p>
          <Button onClick={handlePublishApp} disabled={isPublishing || !publishApp}>
            {isPublishing && <Spin className="mr-2 size-4" />}
            {t('table:baseShare.goToPublish')}
          </Button>
        </div>
      )}
    </div>
  );
};

export const NodeShareContent = ({
  baseId,
  nodeId,
  node,
  hideHeader,
}: {
  baseId: string;
  nodeId: string;
  node: TreeItemData;
  hideHeader?: boolean;
}) => {
  const { t } = useTranslation(['common', 'table']);
  const queryClient = useQueryClient();

  const { sharedNodeIds } = useSharedNodeIds();
  const isNodeShared = sharedNodeIds.has(nodeId);

  const { data: share, isLoading } = useQuery({
    queryKey: ReactQueryKeys.baseShareByNodeId(baseId, nodeId),
    queryFn: () =>
      getBaseShareByNodeId(baseId, nodeId)
        .then((res) => res.data)
        .catch(() => null),
    enabled: isNodeShared,
  });

  const shareUrl = useMemo(() => {
    if (!share) return '';
    return getShareUrl(share.shareId);
  }, [share]);

  const { mutate: createShare, isPending: isCreateLoading } = useMutation({
    mutationFn: (data: ICreateBaseShareRo) => createBaseShare(baseId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseShareByNodeId(baseId, nodeId),
      });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseShareList(baseId),
        exact: true,
      });
      toast.success(t('table:baseShare.createSuccess'));
    },
    onError: () => {
      toast.error(t('table:baseShare.createFailed'));
    },
  });

  const { mutate: updateShare } = useMutation({
    mutationFn: (data: IUpdateBaseShareRo) => updateBaseShare(baseId, share!.shareId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseShareByNodeId(baseId, nodeId),
      });
    },
    onError: () => {
      toast.error(t('table:baseShare.updateFailed'));
    },
  });

  const { mutate: deleteShare, isPending: isDeleteLoading } = useMutation({
    mutationFn: () => deleteBaseShare(baseId, share!.shareId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseShareByNodeId(baseId, nodeId),
      });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseShareList(baseId),
        exact: true,
      });
      toast.success(t('table:baseShare.deleteSuccess'));
    },
    onError: () => {
      toast.error(t('table:baseShare.deleteFailed'));
    },
  });

  const { mutate: refreshShareFn, isPending: isRefreshLoading } = useMutation({
    mutationFn: () => refreshBaseShare(baseId, share!.shareId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseShareByNodeId(baseId, nodeId),
      });
      toast.success(t('table:baseShare.refreshSuccess'));
    },
    onError: () => {
      toast.error(t('table:baseShare.refreshFailed'));
    },
  });

  const handleUpdateSetting = (data: Record<string, unknown>) => {
    if (!share) return;
    updateShare(data as IUpdateBaseShareRo);
  };

  const showEdit =
    node.resourceType === BaseNodeResourceType.Table ||
    node.resourceType === BaseNodeResourceType.Folder;

  const permissionOptions = useBaseSharePermissionOptions({
    share,
    onUpdate: handleUpdateSetting,
    showEdit,
  });

  if (node.resourceType === BaseNodeResourceType.App) {
    return (
      <AppNodeShareContent node={node} nodeId={nodeId} baseId={baseId} hideHeader={hideHeader} />
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spin className="size-6" />
      </div>
    );
  }

  return (
    <BaseShareContent
      className="py-4"
      header={!hideHeader ? <NodeShareHeader node={node} /> : undefined}
      share={share || null}
      shareUrl={shareUrl}
      isCreateLoading={isCreateLoading}
      isDeleteLoading={isDeleteLoading}
      isRefreshLoading={isRefreshLoading}
      permissionOptions={permissionOptions}
      onToggleShare={() => createShare({ nodeId })}
      onUpdateSetting={handleUpdateSetting}
      onDeleteShare={() => deleteShare()}
      onRefreshShare={() => refreshShareFn()}
    />
  );
};
