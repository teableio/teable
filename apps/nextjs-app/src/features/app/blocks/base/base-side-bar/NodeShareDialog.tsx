import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sharePasswordSchema } from '@teable/core';
import { ArrowUpRight, Copy, Edit, Qrcode, RefreshCcw } from '@teable/icons';
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
import { useBaseId } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { ChevronRight, Eye, HelpCircle } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { useMemo, useState } from 'react';
import { useAppPublishContext } from '@/features/app/blocks/table/table-header/publish-base/AppPublishContext';
import { CopyButton } from '@/features/app/components/CopyButton';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { BaseNodeResourceIconMap, getNodeIcon, getNodeName } from '../base-node/hooks';
import type { TreeItemData } from '../base-node/hooks';
import { useBaseNodeContext } from '../base-node/hooks/useBaseNodeContext';
import { useSharedNodeIds } from './BaseNodeShareIndicator';

interface INodeShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
}

const getShareUrl = (shareId: string) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.teable.ai';
  return `${origin}/share/${shareId}/base`;
};

const getEmbedUrl = (shareUrl: string) => {
  const url = new URL(shareUrl);
  url.searchParams.append('embed', 'true');
  return url.toString();
};

const getEmbedHtml = (shareUrl: string) => {
  const embedUrl = getEmbedUrl(shareUrl);
  return `<iframe src="${embedUrl}" width="100%" height="533" style="border: 0"></iframe>`;
};

// Embed Config Popover Component
const EmbedConfigPopover = ({ shareUrl }: { shareUrl: string }) => {
  const { t } = useTranslation(['common', 'table']);
  const [previewOpen, setPreviewOpen] = useState(false);

  const embedHtml = getEmbedHtml(shareUrl);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(embedHtml);
    toast.success(t('common:actions.copySuccess'));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="flex w-full items-center justify-between px-0 py-1">
          <Label className="cursor-pointer text-sm font-normal">
            {t('table:baseShare.embedConfig')}
          </Label>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-80">
        {/* iframe code preview */}
        <div className="mb-3 rounded-md bg-muted p-3">
          <code className="break-all text-xs">{embedHtml}</code>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="mr-1 size-4" />
              {t('table:toolbar.others.share.embedPreview')}
            </Button>
            <DialogContent className="sm:max-w-[425px] md:max-w-[600px] lg:max-w-[800px]">
              <DialogHeader>
                <DialogTitle>{t('table:toolbar.others.share.embedPreview')}</DialogTitle>
              </DialogHeader>
              <div className="h-[500px]">
                <iframe
                  src={getEmbedUrl(shareUrl)}
                  title="embed preview"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                />
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" className="flex-1" onClick={handleCopyCode}>
            <Copy className="mr-1 size-4" />
            {t('table:toolbar.others.share.copyCode')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

// Main content component - single share per node
const NodeShareContent = ({
  baseId,
  nodeId,
  node,
}: {
  baseId: string;
  nodeId: string;
  node: TreeItemData;
}) => {
  const { t } = useTranslation(['common', 'table']);
  const queryClient = useQueryClient();
  const { publishApp } = useAppPublishContext();

  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [sharePassword, setSharePassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const nodeName = getNodeName(node);
  const nodeIcon = getNodeIcon(node);
  const NodeTypeIcon = BaseNodeResourceIconMap[node.resourceType];

  // Get shared node IDs to avoid unnecessary API calls
  const sharedNodeIds = useSharedNodeIds();
  const isNodeShared = sharedNodeIds.has(nodeId);

  // Query share for this specific node - only if nodeId is in the shared list
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

  // Create share mutation
  const { mutate: createShare, isPending: isCreateLoading } = useMutation({
    mutationFn: (data: ICreateBaseShareRo) => createBaseShare(baseId, data),
    onSuccess: () => {
      // Invalidate both the specific node share query and the base share list
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

  // Update share mutation
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

  // Delete share mutation
  const { mutate: deleteShare, isPending: isDeleteLoading } = useMutation({
    mutationFn: () => deleteBaseShare(baseId, share!.shareId),
    onSuccess: () => {
      // Invalidate both the specific node share query and the base share list
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseShareByNodeId(baseId, nodeId),
      });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseShareList(baseId),
        exact: true,
      });
      toast.success(t('table:baseShare.deleteSuccess'));
      setShowDeleteConfirm(false);
    },
    onError: () => {
      toast.error(t('table:baseShare.deleteFailed'));
    },
  });

  // Refresh share link mutation
  const { mutate: refreshShare, isPending: isRefreshLoading } = useMutation({
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

  const handleToggleShare = (enabled: boolean) => {
    if (enabled) {
      createShare({ nodeId });
    } else {
      setShowDeleteConfirm(true);
    }
  };

  const handleUpdateSetting = (data: Partial<IUpdateBaseShareRo>) => {
    if (!share) return;
    updateShare(data);
  };

  const handlePasswordSwitchChange = (checked: boolean) => {
    if (checked) {
      setShowPasswordDialog(true);
    } else {
      handleUpdateSetting({ password: null });
    }
  };

  const confirmSharePassword = () => {
    handleUpdateSetting({ password: sharePassword });
    setShowPasswordDialog(false);
    setSharePassword('');
  };

  const closeSharePasswordDialog = () => {
    setSharePassword('');
    setShowPasswordDialog(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spin className="size-6" />
      </div>
    );
  }

  // Special handling for App nodes - show publicUrl if published, or prompt to publish
  const isAppNode = node.resourceType === BaseNodeResourceType.App;
  const appPublicUrl = isAppNode
    ? (node.resourceMeta as IBaseNodeAppResourceMeta)?.publicUrl
    : null;

  const handlePublishApp = async () => {
    if (!publishApp) return;

    setIsPublishing(true);
    try {
      await publishApp({
        nodeId,
        name: (node.resourceMeta as IBaseNodeAppResourceMeta)?.name || '',
        resourceId: node.resourceId,
      });
      // Invalidate tree to refresh the app node with new publicUrl
      queryClient.invalidateQueries({ queryKey: ['baseNodeTree', baseId] });
      toast.success(t('table:baseShare.publishSuccess'));
    } catch {
      toast.error(t('table:baseShare.publishFailed'));
    } finally {
      setIsPublishing(false);
    }
  };

  if (isAppNode) {
    return (
      <div className="flex w-full flex-col gap-4 overflow-hidden px-1 py-2">
        {/* Header with node icon and name */}
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

        {appPublicUrl ? (
          // App is published - show publicUrl
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-semibold">{t('table:baseShare.appPublicLink')}</Label>
            <div className="flex items-center gap-2">
              <div className="flex h-9 flex-1 items-center justify-between truncate text-nowrap rounded-md border bg-card p-2 pl-3">
                <span className="truncate text-nowrap text-sm text-muted-foreground">
                  {appPublicUrl}
                </span>
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="size-9 p-0"
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
                  <Button variant="outline" size="icon">
                    <Qrcode className="size-4 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="size-48 bg-white p-2">
                  <QRCodeSVG value={appPublicUrl} className="size-full" />
                </PopoverContent>
              </Popover>
              <CopyButton text={appPublicUrl} variant="outline" size="icon" />
            </div>
          </div>
        ) : (
          // App is not published - show publish button
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
  }

  const isShareEnabled = !!share;

  return (
    <div className="flex w-full flex-col gap-4 overflow-hidden px-1 py-2">
      {/* Header with node icon and name */}
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

      {/* Share to web toggle */}
      <div className="flex items-center gap-2">
        {isCreateLoading ? (
          <Spin className="size-5" />
        ) : (
          <Switch id="share-switch" checked={isShareEnabled} onCheckedChange={handleToggleShare} />
        )}
        <Label htmlFor="share-switch" className="text-sm">
          {t('table:baseShare.shareToWeb')}
        </Label>
      </div>

      {/* Show content only when share is enabled */}
      {isShareEnabled && share && (
        <>
          {/* Share Link Section */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-semibold">{t('table:baseShare.shareLink')}</Label>
            <div className="flex items-center gap-2">
              <div className="flex h-9 flex-1 items-center justify-between truncate text-nowrap rounded-md border bg-card p-2 pl-3">
                <span className="truncate text-nowrap text-sm text-muted-foreground">
                  {shareUrl}
                </span>
              </div>
              <CopyButton text={shareUrl} variant="outline" size="icon" />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon">
                    <Qrcode className="size-4 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="size-48 bg-white p-2">
                  <QRCodeSVG value={shareUrl} className="size-full" />
                </PopoverContent>
              </Popover>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      className="size-9 p-0"
                      onClick={() => refreshShare()}
                      disabled={isRefreshLoading}
                    >
                      {isRefreshLoading ? <Spin className="size-4" /> : <RefreshCcw />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('table:baseShare.refreshLink')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <Separator />

          {/* Security Section */}
          <div className="flex flex-col gap-3">
            <Label className="text-sm font-medium">{t('table:baseShare.security')}</Label>

            {/* Allow Copy */}
            <div className="flex items-center gap-2">
              <Switch
                id="share-allowCopy"
                checked={share.allowCopy ?? false}
                onCheckedChange={(checked) => handleUpdateSetting({ allowCopy: checked })}
              />
              <Label className="text-sm font-normal" htmlFor="share-allowCopy">
                {t('table:baseShare.allowCopyData')}
              </Label>
            </div>

            {/* Allow Duplicate/Save */}
            <div className="flex items-center gap-2">
              <Switch
                id="share-allowSave"
                checked={share.allowSave ?? false}
                onCheckedChange={(checked) => handleUpdateSetting({ allowSave: checked })}
              />
              <Label className="text-sm font-normal" htmlFor="share-allowSave">
                {t('table:baseShare.allowDuplicate')}
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="size-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">{t('table:baseShare.allowSaveDescription')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Password Protection */}
            <div className="flex items-center gap-2">
              <Switch
                id="share-password"
                checked={Boolean(share.password)}
                onCheckedChange={handlePasswordSwitchChange}
              />
              <Label className="text-sm font-normal" htmlFor="share-password">
                {t('table:baseShare.restrictByPassword')}
              </Label>
              {Boolean(share.password) && (
                <Button
                  className="h-5 px-1 hover:text-muted-foreground"
                  variant="link"
                  size="xs"
                  onClick={() => setShowPasswordDialog(true)}
                >
                  <Edit className="size-3" />
                </Button>
              )}
            </div>
          </div>

          <Separator />

          {/* Advanced Section */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t('table:baseShare.advanced')}</Label>
            <EmbedConfigPopover shareUrl={shareUrl} />
          </div>
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('table:baseShare.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('table:baseShare.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteShare()}
              disabled={isDeleteLoading}
            >
              {isDeleteLoading && <Spin className="mr-2 size-4" />}
              {t('common:actions.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Password Dialog */}
      <Dialog
        open={showPasswordDialog}
        onOpenChange={(open) => !open && closeSharePasswordDialog()}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('table:toolbar.others.share.passwordTitle')}</DialogTitle>
          </DialogHeader>
          <Input
            className="h-9"
            type="password"
            value={sharePassword}
            onChange={(e) => setSharePassword(e.target.value)}
            placeholder={t('table:baseShare.enterPassword')}
          />
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={closeSharePasswordDialog}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={confirmSharePassword}
              disabled={!sharePasswordSchema.safeParse(sharePassword).success}
            >
              {t('common:actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const NodeShareDialog = (props: INodeShareDialogProps) => {
  const { open, onOpenChange, nodeId } = props;
  const baseId = useBaseId() as string;
  const { treeItems } = useBaseNodeContext();

  const node = treeItems[nodeId];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Share</DialogTitle>
        </DialogHeader>
        {baseId && nodeId && node && (
          <NodeShareContent baseId={baseId} nodeId={nodeId} node={node} />
        )}
      </DialogContent>
    </Dialog>
  );
};
