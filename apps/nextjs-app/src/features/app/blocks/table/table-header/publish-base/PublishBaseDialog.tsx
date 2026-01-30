import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateAttachmentId } from '@teable/core';
import { Discord, Heart, InIcon, Link, Plus, Twitter } from '@teable/icons';
import type { ITemplateCoverRo, INotifyVo } from '@teable/openapi';
import {
  getTemplateByBaseId,
  publishBase,
  unpublishTemplate,
  UploadType,
  BaseNodeResourceType,
} from '@teable/openapi';
import { AttachmentManager } from '@teable/sdk/components';
import { useBase } from '@teable/sdk/hooks';
import { Spin, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Switch,
  Textarea,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import confetti from 'canvas-confetti';
import { Camera, Send, Copy, ExternalLink } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { ROOT_ID } from '../../../base/base-node/hooks';
import { useBaseNodeContext } from '../../../base/base-node/hooks/useBaseNodeContext';
import { useAppPublishContext } from './AppPublishContext';
import { NodeSelect } from './NodeSelect';
import { NodeTreeSelect } from './NodeTreeSelect';
import type { IUnpublishedApp } from './UnpublishedAppsDialog';
import { UnpublishedAppsDialog, getUnpublishedAppNodes } from './UnpublishedAppsDialog';

const attachmentManager = new AttachmentManager(1);

const generateShareUrl = (
  permalink?: string,
  defaultUrl?: string,
  snapshotBaseId?: string
): string => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Prioritize permalink for stable sharing URL
  const relativeUrl =
    permalink || defaultUrl || (snapshotBaseId && `/base/${snapshotBaseId}`) || '';
  return relativeUrl ? `${origin}${relativeUrl}` : '';
};

interface IPublishBaseDialogProps {
  children: React.ReactNode;
  onClose: () => void;
  closeOnSuccess?: boolean;
}

export const PublishBaseDialog = (props: IPublishBaseDialogProps) => {
  const { children, onClose, closeOnSuccess = false } = props;
  const { t } = useTranslation(['space', 'common']);
  const base = useBase();
  const baseId = base?.id;
  const { treeItems } = useBaseNodeContext();
  const isCloud = useIsCloud();
  const appPublishContext = useAppPublishContext();

  const queryClient = useQueryClient();

  const allNodeIds = useMemo(() => {
    const nodeIds: string[] = [];
    Object.entries(treeItems).forEach(([id]) => {
      if (id !== ROOT_ID) {
        nodeIds.push(id);
      }
    });
    return nodeIds;
  }, [treeItems]);

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(base?.name || '');
  const [description, setDescription] = useState<string | undefined>('');
  const [screenshotUrl, setScreenshotUrl] = useState<string | undefined>();
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedCover, setUploadedCover] = useState<
    | (INotifyVo & {
        id: string;
        name: string;
      })
    | null
  >(null);
  const [includeData, setIncludeData] = useState(true);
  const [defaultActiveNodeId, setDefaultActiveNodeId] = useState<string | null | undefined>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [hasLoadedTemplate, setHasLoadedTemplate] = useState(false);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [unpublishedAppsDialogOpen, setUnpublishedAppsDialogOpen] = useState(false);
  const [unpublishedApps, setUnpublishedApps] = useState<IUnpublishedApp[]>([]);
  const [externalApps, setExternalApps] = useState<IUnpublishedApp[] | undefined>(undefined);

  const { data: templateDetail } = useQuery({
    queryKey: ['template-by-base', baseId],
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => getTemplateByBaseId(baseId!).then((res) => res.data),
    enabled: !!baseId,
  });
  const isTemplatePublished = templateDetail?.isPublished;
  const isTemplateFeatured = templateDetail?.featured ?? false;

  // Handle template data changes (replaces onSuccess callback removed in React Query v5)
  useEffect(() => {
    if (!templateDetail) return;

    setTitle(templateDetail?.name || base?.name || '');
    setDescription(templateDetail?.description);
    // only update with server data when no manual upload of image
    if (!uploadedCover) {
      setScreenshotUrl(templateDetail?.cover?.presignedUrl || undefined);
    }

    const savedNodes = templateDetail?.publishInfo?.nodes;
    const nodesToSelect = savedNodes && savedNodes.length > 0 ? savedNodes : allNodeIds;
    if (nodesToSelect.length > 0) {
      setSelectedNodeIds(nodesToSelect);

      // Set default active node: use saved data if available and it's in selected nodes
      const savedDefaultNodeId = templateDetail?.publishInfo?.defaultActiveNodeId;
      if (savedDefaultNodeId && nodesToSelect.includes(savedDefaultNodeId)) {
        setDefaultActiveNodeId(savedDefaultNodeId);
      } else {
        // Find first non-folder node in selected nodes
        const firstNonFolderNode = nodesToSelect.find((id: string) => {
          const node = treeItems[id];
          return node && node.resourceType !== BaseNodeResourceType.Folder;
        });
        setDefaultActiveNodeId(firstNonFolderNode || null);
      }

      // Only mark as loaded when nodes are actually set
      setHasLoadedTemplate(true);
    }
    setIncludeData(templateDetail?.publishInfo?.includeData ?? true);
    // Use permalink for stable share URL
    const permalink = templateDetail?.id ? `/t/${templateDetail.id}` : undefined;
    setShareUrl(
      generateShareUrl(
        permalink,
        templateDetail?.publishInfo?.defaultUrl,
        templateDetail?.snapshot?.baseId
      )
    );
  }, [templateDetail, base?.name, allNodeIds, treeItems, uploadedCover]);

  const { mutateAsync: unpublishTemplateMutate, isPending: unpublishTemplateLoading } = useMutation(
    {
      mutationFn: () => unpublishTemplate(templateDetail?.id as string).then((res) => res.data),
      onSuccess: () => {
        toast.success(t('publishBase.unPublishSuccess'));
        queryClient.invalidateQueries({ queryKey: ['template-by-base', baseId] });
        setTitle('');
        setDescription('');
        setScreenshotUrl(undefined);
        setUploadedCover(null);
      },
    }
  );

  const { mutateAsync: publishBaseMutate, isPending: publishBaseLoading } = useMutation({
    mutationFn: async ({ title, description }: { title: string; description: string }) => {
      // if user manually uploaded a new image, use the new cover; otherwise use the existing cover
      const cover: ITemplateCoverRo | null = uploadedCover
        ? {
            id: uploadedCover.id,
            name: uploadedCover.name,
            token: uploadedCover.token,
            size: uploadedCover.size,
            url: uploadedCover.url,
            path: uploadedCover.path,
            mimetype: uploadedCover.mimetype,
            width: uploadedCover.width,
            height: uploadedCover.height,
          }
        : templateDetail?.cover || null;

      return publishBase(baseId!, {
        title,
        description,
        cover,
        nodes: selectedNodeIds.length > 0 ? selectedNodeIds : undefined,
        includeData,
        defaultActiveNodeId,
      }).then((res) => res.data);
    },
    onSuccess: (data) => {
      const { baseId: templateBaseId, defaultUrl, permalink } = data;
      queryClient.invalidateQueries({ queryKey: ['template-by-base', baseId] });
      // after publish success, clear the uploaded cover, use server data next time
      setUploadedCover(null);
      // Close the publish dialog and show success dialog
      setOpen(false);
      // Generate share URL with permalink
      setShareUrl(generateShareUrl(permalink, defaultUrl, templateBaseId));
      setSuccessDialogOpen(true);
      // Trigger fireworks effect
      fireConfetti();
      // Close parent dialog if closeOnSuccess is true
      if (closeOnSuccess) {
        onClose();
      }
    },
  });

  // Initialize selected nodes on first load
  useEffect(() => {
    if (allNodeIds.length > 0 && !hasLoadedTemplate && selectedNodeIds.length === 0) {
      setSelectedNodeIds(allNodeIds);

      // Also set default active node when initializing selected nodes
      const firstNonFolderNode = allNodeIds.find((id) => {
        const node = treeItems[id];
        return node && node.resourceType !== BaseNodeResourceType.Folder;
      });
      setDefaultActiveNodeId(firstNonFolderNode || null);
      setHasLoadedTemplate(true);
    }
  }, [allNodeIds, hasLoadedTemplate, selectedNodeIds.length, treeItems]);

  // Ensure defaultActiveNodeId is always within selectedNodeIds (selected non-folder nodes only)
  useEffect(() => {
    // Skip if no selected nodes
    if (selectedNodeIds.length === 0) return;

    // Calculate selected non-folder nodes to avoid dependency on memoized array
    const currentSelectedNonFolderNodes = selectedNodeIds.filter((id) => {
      const node = treeItems[id];
      return node && node.resourceType !== BaseNodeResourceType.Folder;
    });

    // If no default active node is set, or the current one is not in selected nodes, set the first selected non-folder node
    if (!defaultActiveNodeId || !selectedNodeIds.includes(defaultActiveNodeId)) {
      if (currentSelectedNonFolderNodes.length > 0) {
        setDefaultActiveNodeId(currentSelectedNonFolderNodes[0]);
      } else {
        setDefaultActiveNodeId(null);
      }
    }
  }, [defaultActiveNodeId, selectedNodeIds, treeItems]);

  useEffect(() => {
    if (!open) {
      // when dialog is closed, reset upload state
      setUploadedCover(null);
      setUploadProgress(0);
      setIsUploading(false);
      setHasLoadedTemplate(false);
    }
  }, [open]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    // validate file type
    if (!file.type.startsWith('image/')) {
      toast.error(t('publishBase.invalidImageType'));
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const attachmentId = generateAttachmentId();
    const fileName = file.name;
    const toastId = toast.loading(t('publishBase.uploading'));

    attachmentManager.upload(
      [{ id: attachmentId, instance: file }],
      UploadType.Template,
      {
        successCallback: (_, result: INotifyVo) => {
          setScreenshotUrl(result.presignedUrl);
          setUploadedCover({
            ...result,
            id: attachmentId,
            name: fileName,
          });
          setIsUploading(false);
          toast.success(t('publishBase.uploadSuccess'), { id: toastId });
        },
        errorCallback: (_, error) => {
          setIsUploading(false);
          toast.error(error || t('publishBase.uploadFailed'), { id: toastId });
        },
        progressCallback: (_, progress) => {
          setUploadProgress(progress);
        },
      },
      baseId
    );
  };

  const handleUploadClick = () => {
    if (uploadRef.current) {
      uploadRef.current.value = '';
      uploadRef.current.click();
    }
  };

  useEffect(() => {
    if (defaultActiveNodeId && !selectedNodeIds.includes(defaultActiveNodeId)) {
      setDefaultActiveNodeId(null);
    }
  }, [selectedNodeIds, defaultActiveNodeId]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(shareUrl);
    toast.success(t('publishBase.urlCopied'));
  };

  const handleShareToX = () => {
    const text = encodeURIComponent(`Check out this template: ${title}`);
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(shareUrl)}`,
      '_blank'
    );
  };

  const handleShareToLinkedIn = () => {
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
      '_blank'
    );
  };

  const handleShareToDiscord = () => {
    // Discord doesn't have a direct share URL, so we just copy the URL
    navigator.clipboard.writeText(shareUrl);
    toast.success(t('publishBase.urlCopiedForDiscord'));
  };

  const fireConfetti = () => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });
  };

  const handlePublishClick = useCallback(() => {
    if (!title || !description) {
      toast.error(t('publishBase.tips.publishValidation'));
      return;
    }

    if (selectedNodeIds.length === 0) {
      toast.error(t('publishBase.tips.atLeastOneNode'));
      return;
    }

    // Check for unpublished app nodes
    const unpublishedAppNodes = getUnpublishedAppNodes(selectedNodeIds, treeItems);
    if (unpublishedAppNodes.length > 0) {
      setUnpublishedApps(unpublishedAppNodes);
      setExternalApps(undefined); // Reset external apps state
      setUnpublishedAppsDialogOpen(true);
      return;
    }

    // No unpublished apps, proceed with publishing
    publishBaseMutate({ title, description: description || '' });
  }, [title, description, selectedNodeIds, treeItems, publishBaseMutate, t]);

  const handleContinuePublish = useCallback(() => {
    setUnpublishedAppsDialogOpen(false);
    publishBaseMutate({ title, description: description || '' });
  }, [title, description, publishBaseMutate]);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="max-w-[960px] gap-0">
          <DialogHeader className="h-20">
            <DialogTitle>{t('publishBase.title')}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t('publishBase.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex w-full gap-10 overflow-x-hidden">
            <div className="relative flex min-w-[358px] flex-1 flex-col gap-6 px-0.5">
              <div className="flex flex-col gap-2">
                <div className="text-sm font-semibold">{t('publishBase.infoTitle')}</div>
                <div className="flex flex-col gap-2">
                  <span className="text-sm">{t('publishBase.form.title')}</span>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('publishBase.form.titlePlaceholder')}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm">{t('publishBase.form.description')}</span>
                  <Textarea
                    className="min-h-12 resize-y"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('publishBase.form.descriptionPlaceholder')}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{t('publishBase.form.publishNode')}</span>
                </div>
                <NodeTreeSelect
                  showCheckbox
                  checkedItems={selectedNodeIds}
                  onCheckedItemsChange={(ids) => {
                    setSelectedNodeIds(ids);
                  }}
                  placeholder={t('common:actions.select')}
                  totalNodeCount={allNodeIds.length}
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">{t('publishBase.form.security')}</span>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="include-data"
                    checked={includeData}
                    onCheckedChange={setIncludeData}
                  />
                  <Label htmlFor="include-data">{t('publishBase.form.includeData')}</Label>
                  {/* <QuestionMarkCircledIcon className="size-4" /> */}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">{t('publishBase.form.advanced')}</span>
                <span className="text-sm">{t('publishBase.form.defaultActiveNode')}</span>
                <NodeSelect
                  nodeIds={selectedNodeIds}
                  value={defaultActiveNodeId || ''}
                  onChange={setDefaultActiveNodeId}
                />
              </div>

              <div className="absolute inset-x-0 bottom-0 flex w-full gap-3">
                {templateDetail && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        className="flex w-full items-center gap-2"
                        variant="outline"
                        disabled={unpublishTemplateLoading}
                      >
                        {t('publishBase.unPublish')}
                        {unpublishTemplateLoading && <Spin className="size-4" />}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t('publishBase.unPublishConfirmTitle')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('publishBase.unPublishConfirmDescription')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => unpublishTemplateMutate()}
                        >
                          {t('common:actions.confirm')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                <Button
                  className="flex w-full items-center gap-2"
                  onClick={handlePublishClick}
                  disabled={publishBaseLoading}
                >
                  <Send className="size-4" />
                  {templateDetail ? t('publishBase.update') : t('publishBase.publish')}

                  {publishBaseLoading && <Spin className="size-4" />}
                </Button>
              </div>
            </div>

            <div className="relative h-[520px] w-[512px] shrink-0 overflow-hidden rounded-lg border bg-muted">
              <input
                ref={uploadRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
              <div className="relative flex size-full flex-col items-center justify-center gap-6 p-5">
                <div className="text-base font-semibold">{t('publishBase.previewTips')}</div>

                <div className="flex w-[432px] flex-col gap-3 bg-transparent">
                  <div
                    className="group relative h-[240px] cursor-pointer overflow-hidden rounded-lg bg-surface"
                    onClick={handleUploadClick}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        handleUploadClick();
                      }
                    }}
                  >
                    {screenshotUrl ? (
                      <>
                        <img
                          src={screenshotUrl}
                          className="size-full object-cover"
                          alt="published base preview"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                          <div className="flex flex-col items-center gap-2">
                            <Camera className="size-8 text-white" />
                            <span className="text-sm text-white">
                              {t('publishBase.changeCover')}
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center gap-3 transition-colors hover:bg-black/5 dark:hover:bg-white/10">
                        {isUploading ? (
                          <>
                            <Spin className="size-8" />
                            <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
                          </>
                        ) : (
                          <>
                            <Plus className="size-8 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                              {t('publishBase.uploadCover')}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 px-1">
                    <div className="flex items-center justify-between">
                      <p
                        className={cn(
                          'text-base font-medium',
                          title ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {title || t('publishBase.form.titlePlaceholder')}
                      </p>

                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {isTemplatePublished && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={cn(
                                    'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                                    isTemplateFeatured
                                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                                      : 'border-muted-foreground/20 bg-muted text-muted-foreground'
                                  )}
                                >
                                  {isTemplateFeatured
                                    ? t('publishBase.featuredLabel')
                                    : t('publishBase.unfeaturedLabel')}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent hideWhenDetached={true}>
                                {isTemplateFeatured
                                  ? t('publishBase.featuredTip')
                                  : t('publishBase.unfeaturedTip')}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        <div className="flex items-center gap-1">
                          <Heart className="size-4" />
                          {templateDetail?.usageCount || 0}
                        </div>
                      </div>
                    </div>
                    <span
                      className={cn(
                        'text-nowrap break-words text-sm truncate',
                        description ? 'text-muted-foreground' : 'text-foreground/50'
                      )}
                      title={description}
                    >
                      {description || t('publishBase.form.descriptionPlaceholder')}
                    </span>
                  </div>
                </div>
                {templateDetail?.isPublished && (
                  <div className="z-50 flex h-9 w-[432px] items-center gap-2 overflow-hidden rounded-md border bg-background pl-3">
                    <Link className="size-4 shrink-0" />
                    <div className="grow truncate text-sm text-muted-foreground">{shareUrl}</div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 shrink-0 rounded-none border-l p-0"
                      onClick={handleCopyUrl}
                    >
                      <Copy className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 shrink-0 rounded-none border-l p-0"
                      onClick={() => window.open(shareUrl, '_blank')}
                    >
                      <ExternalLink className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={successDialogOpen}
        onOpenChange={(open) => {
          setSuccessDialogOpen(open);
          // When success dialog closes and closeOnSuccess is false (Popover version),
          // close the parent component
          if (!open && !closeOnSuccess) {
            onClose();
          }
        }}
      >
        <DialogContent className="max-w-[512px] gap-0 p-0">
          <DialogHeader className="flex h-[60px] flex-col justify-center px-6">
            <DialogTitle className="text-left text-lg font-semibold">
              {t('publishBase.publishSuccess')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex w-full flex-col overflow-hidden px-6 pb-4">
            <span className="text-sm text-muted-foreground">
              {t('publishBase.publishSuccessDescription')}
            </span>

            <div className="flex w-full items-center gap-2 py-2">
              <div className="flex h-9 flex-1 items-center gap-2 truncate rounded-md border px-3 text-sm">
                <Link className="size-4 shrink-0" />
                <div className="flex-1 truncate">{shareUrl}</div>
              </div>
              <Button size="sm" variant="outline" className="size-9 p-0" onClick={handleCopyUrl}>
                <Copy className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="size-9 p-0"
                onClick={() => window.open(shareUrl, '_blank')}
              >
                <ExternalLink className="size-4" />
              </Button>
            </div>

            {isCloud && (
              <div className="flex flex-col gap-3 pt-6">
                <div className="text-sm font-medium">{t('publishBase.shareWith')}</div>
                <div className="flex gap-3">
                  <Button
                    size="lg"
                    variant="outline"
                    className="size-9 rounded-lg p-0"
                    onClick={handleShareToX}
                  >
                    <Twitter className="size-6 p-0.5" />
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="size-9 rounded-lg p-0"
                    onClick={handleShareToLinkedIn}
                  >
                    <InIcon className="size-6 fill-[#0A66C2] p-0.5" />
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="size-9 rounded-lg p-0"
                    onClick={handleShareToDiscord}
                  >
                    <Discord className="size-6 fill-[#5865F2] p-0.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <UnpublishedAppsDialog
        open={unpublishedAppsDialogOpen}
        onOpenChange={setUnpublishedAppsDialogOpen}
        unpublishedApps={unpublishedApps}
        treeItems={treeItems}
        onContinue={handleContinuePublish}
        onPublishApp={appPublishContext.publishApp}
        externalApps={externalApps}
      />
    </>
  );
};
