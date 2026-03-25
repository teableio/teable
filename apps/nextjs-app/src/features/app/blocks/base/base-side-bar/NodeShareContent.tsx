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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import { Check, ChevronDown, ChevronRight, Eye, HelpCircle } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { useMemo, useState } from 'react';
import { useAppPublishContext } from '@/features/app/blocks/table/table-header/publish-base/AppPublishContext';
import { CopyButton } from '@/features/app/components/CopyButton';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { BaseNodeResourceIconMap, getNodeIcon, getNodeName } from '../base-node/hooks';
import type { TreeItemData } from '../base-node/hooks';
import { useSharedNodeIds } from './BaseNodeShareIndicator';

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
        <Button
          variant="ghost"
          className="-mx-2 flex w-[calc(100%+16px)] items-center justify-between px-2 py-1"
        >
          <Label className="cursor-pointer text-sm font-normal">
            {t('table:baseShare.embedConfig')}
          </Label>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-80">
        {/* iframe code preview */}
        <div className="mb-3 rounded-md border bg-muted p-3">
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
              <div className="h-[500px] overflow-hidden rounded-md border">
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
  const { publishApp } = useAppPublishContext();

  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [sharePassword, setSharePassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const sharedNodeIds = useSharedNodeIds();
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
      setShowDeleteConfirm(false);
    },
    onError: () => {
      toast.error(t('table:baseShare.deleteFailed'));
    },
  });

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
  }

  const isShareEnabled = !!share;

  return (
    <div className="flex w-full flex-col gap-4 py-4">
      {!hideHeader && <NodeShareHeader node={node} />}

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

      {isShareEnabled && share && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('table:baseShare.linkHolderLabel')}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center gap-0.5 text-blue-500 hover:text-blue-600">
                    {share.allowSave
                      ? t('table:baseShare.linkHolderCanCopyAndSave')
                      : t('table:baseShare.linkHolderCanView')}
                    <ChevronDown className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    className={!share.allowSave ? 'text-blue-500' : ''}
                    onClick={() => handleUpdateSetting({ allowSave: false })}
                  >
                    {!share.allowSave ? (
                      <Check className="mr-2 size-4" />
                    ) : (
                      <span className="mr-2 size-4" />
                    )}
                    {t('table:baseShare.linkHolderCanView')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={share.allowSave ? 'text-blue-500' : ''}
                    onClick={() => handleUpdateSetting({ allowSave: true })}
                  >
                    {share.allowSave ? (
                      <Check className="mr-2 size-4" />
                    ) : (
                      <span className="mr-2 size-4" />
                    )}
                    {t('table:baseShare.linkHolderCanCopyAndSave')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center gap-2">
              <Input className="min-w-0 flex-1" value={shareUrl} readOnly />
              <CopyButton text={shareUrl} variant="outline" size="icon-sm" className="shrink-0" />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon-sm" className="shrink-0">
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
                      size="icon-sm"
                      className="shrink-0"
                      onClick={() => refreshShare()}
                      disabled={isRefreshLoading}
                    >
                      {isRefreshLoading ? (
                        <Spin className="size-4" />
                      ) : (
                        <RefreshCcw className="size-4 shrink-0" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{t('table:baseShare.refreshLink')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <Label className="text-sm font-medium">{t('table:baseShare.advanced')}</Label>

            <div className="flex items-center gap-2">
              <Switch
                id="share-allowCopy"
                checked={Boolean(share.allowCopy)}
                onCheckedChange={(checked) => handleUpdateSetting({ allowCopy: checked })}
              />
              <Label className="text-sm font-normal" htmlFor="share-allowCopy">
                {t('table:baseShare.allowCopyData')}
              </Label>
            </div>

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
                  <Edit className="size-4" />
                </Button>
              )}
            </div>

            <EmbedConfigPopover shareUrl={shareUrl} />
          </div>
        </>
      )}

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

      <Dialog
        open={showPasswordDialog}
        onOpenChange={(open) => !open && closeSharePasswordDialog()}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('table:toolbar.others.share.passwordTitle')}</DialogTitle>
          </DialogHeader>
          <Input
            size="lg"
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
