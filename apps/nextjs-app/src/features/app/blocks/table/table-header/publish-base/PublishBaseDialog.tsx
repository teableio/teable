import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateAttachmentId } from '@teable/core';
import { Discord, InIcon, Link, Plus, Twitter } from '@teable/icons';
import type { ITemplateCoverRo, INotifyVo, IPublishBaseRo, IGetBaseVo } from '@teable/openapi';
import {
  getBaseNodeTree,
  getTemplateByBaseId,
  publishBase,
  unpublishTemplate,
  UploadType,
  BaseNodeResourceType,
  ShortLinkType,
} from '@teable/openapi';
import { AttachmentManager } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
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
  DialogFooter,
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
import { noop } from 'lodash';
import { Camera, Send, Copy, ExternalLink } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState, useRef, useEffect, useMemo, useCallback, useContext } from 'react';
import { TemplateHostContext } from '@/features/app/components/space/template/host-context';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { useOrigin } from '@/features/app/hooks/useOrigin';
import { useShortLink } from '@/features/app/hooks/useShortLink';
import { asTranslate, type ITranslate } from '@/features/app/utils/translate';
import { BaseNodeContext } from '../../../base/base-node/BaseNodeContext';
import { buildTreeItems, filterAutoHiddenFolders, ROOT_ID } from '../../../base/base-node/hooks';
import { useAppPublishContext } from './AppPublishContext';
import { normalizeCheckedItems } from './node-tree-check';
import { NodeSelect } from './NodeSelect';
import { NodeTreeSelect } from './NodeTreeSelect';
import { TemplateChangelogField, TemplateReviewPanel } from './TemplateSubmissionState';
import type { IUnpublishedApp } from './UnpublishedAppsDialog';
import { UnpublishedAppsDialog, getUnpublishedAppNodes } from './UnpublishedAppsDialog';

const attachmentManager = new AttachmentManager(1);

const generateShareUrl = (
  origin: string,
  permalink?: string,
  defaultUrl?: string,
  snapshotBaseId?: string
): string => {
  // Prioritize permalink for stable sharing URL
  const relativeUrl =
    permalink || defaultUrl || (snapshotBaseId && `/base/${snapshotBaseId}`) || '';
  return relativeUrl ? `${origin}${relativeUrl}` : '';
};

interface IPublishBaseDialogProps {
  base: IGetBaseVo;
  children?: React.ReactNode;
  onClose: () => void;
  closeOnSuccess?: boolean;
  // Controlled mode, for callers that must not mount the dialog inside a dropdown menu
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const useControllableOpen = (open?: boolean, onOpenChange?: (open: boolean) => void) => {
  const [innerOpen, setInnerOpen] = useState(false);
  return [open ?? innerOpen, onOpenChange ?? setInnerOpen] as const;
};

export const PublishBaseDialog = (props: IPublishBaseDialogProps) => {
  const { base, children, onClose, closeOnSuccess = false } = props;
  const { t } = useTranslation(['space', 'common']);
  const baseId = base.id;
  const [open, setOpen] = useControllableOpen(props.open, props.onOpenChange);
  // Read by id rather than from the page, so the dialog can publish a project other than the open one.
  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ReactQueryKeys.baseNodeTree(baseId),
    queryFn: () => getBaseNodeTree(baseId).then((res) => res.data),
    enabled: open,
  });
  const nodeContext = useMemo(() => {
    const nodes = tree?.nodes ?? [];
    return {
      isLoading: treeLoading,
      isLoaded: Boolean(tree),
      maxFolderDepth: tree?.maxFolderDepth ?? 2,
      treeItems: buildTreeItems(base.restrictedAuthority ? filterAutoHiddenFolders(nodes) : nodes),
      setTreeItems: noop,
      invalidateMenu: noop,
    };
  }, [tree, treeLoading, base.restrictedAuthority]);
  const { treeItems } = nodeContext;
  const isCloud = useIsCloud();
  const appPublishContext = useAppPublishContext();
  const host = useContext(TemplateHostContext);
  const { submission } = host;

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
  const [title, setTitle] = useState(base.name ?? '');
  const [description, setDescription] = useState<string | undefined>('');
  const [changelog, setChangelog] = useState('');
  const [changelogOpen, setChangelogOpen] = useState(false);
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
  // the template response whose saved nodes were last applied to the selection
  const seededTemplateRef = useRef<unknown>(null);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [unpublishedAppsDialogOpen, setUnpublishedAppsDialogOpen] = useState(false);
  const [unpublishedApps, setUnpublishedApps] = useState<IUnpublishedApp[]>([]);
  const [externalApps, setExternalApps] = useState<IUnpublishedApp[] | undefined>(undefined);

  const { data: templateDetail } = useQuery({
    queryKey: ['template-by-base', baseId],
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => getTemplateByBaseId(baseId).then((res) => res.data),
    enabled: open,
  });
  const isTemplatePublished = templateDetail?.isPublished;
  const isTemplateFeatured = templateDetail?.featured ?? false;
  const savedCoverUrl = templateDetail?.cover?.presignedUrl || undefined;
  const origin = useOrigin();

  // Prefer the short URL when sharing a published template; only fall back to
  // the permalink when short link creation failed (empty while loading)
  const { shortUrl, isFallback } = useShortLink(
    isTemplatePublished && templateDetail?.id
      ? { type: ShortLinkType.Template, resourceId: templateDetail.id }
      : undefined
  );
  const displayShareUrl = shortUrl ?? (isFallback ? shareUrl : '');

  // Handle template data changes (replaces onSuccess callback removed in React Query v5)
  useEffect(() => {
    if (!templateDetail) return;

    setTitle(templateDetail?.name || base.name || '');
    setDescription(templateDetail?.description);
    // only update with server data when no manual upload of image
    if (!uploadedCover) {
      setScreenshotUrl(savedCoverUrl);
    }
    setIncludeData(templateDetail?.publishInfo?.includeData ?? true);
    // Use permalink for stable share URL
    const permalink = templateDetail?.id ? `/t/${templateDetail.id}` : undefined;
    setShareUrl(
      generateShareUrl(
        origin,
        permalink,
        templateDetail?.publishInfo?.defaultUrl,
        templateDetail?.snapshot?.baseId
      )
    );
  }, [templateDetail, base.name, uploadedCover, origin, savedCoverUrl]);

  // Seed the selection from saved nodes once per template response; base-node refreshes
  // must not overwrite what the user has (un)checked since
  useEffect(() => {
    // wait for the node tree too, saved nodes are normalized against it
    if (!templateDetail || seededTemplateRef.current === templateDetail) return;
    if (allNodeIds.length === 0) return;

    const savedNodes = templateDetail?.publishInfo?.nodes;
    const nodesToSelect =
      savedNodes && savedNodes.length > 0
        ? normalizeCheckedItems(treeItems, savedNodes)
        : allNodeIds;
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

    // even an empty result counts as loaded so the select-all init does not kick in
    setHasLoadedTemplate(true);
    seededTemplateRef.current = templateDetail;
  }, [templateDetail, allNodeIds, treeItems]);

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

  const buildPublishRo = (title: string, description: string): IPublishBaseRo => {
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

    return {
      title,
      description,
      cover,
      // Everything ticked means the whole project, so a later submission follows it as it grows.
      nodes:
        selectedNodeIds.length > 0 &&
        (base.restrictedAuthority || !allNodeIds.every((id) => selectedNodeIds.includes(id)))
          ? selectedNodeIds
          : undefined,
      includeData,
      defaultActiveNodeId,
    };
  };

  const { mutate: withdrawMutate, isPending: withdrawLoading } = useMutation({
    mutationFn: () => submission!.withdraw(templateDetail!.id),
    onSuccess: () => {
      toast.success(t('publishBase.review.withdrawn'));
      queryClient.invalidateQueries({ queryKey: ['template-by-base', baseId] });
    },
  });

  const { mutateAsync: publishMutate, isPending: publishLoading } = useMutation({
    mutationFn: async ({ title, description }: { title: string; description: string }) => {
      const ro = buildPublishRo(title, description);
      if (!submission) {
        return publishBase(baseId, ro).then((res) => res.data);
      }
      await submission.submit(baseId, {
        ...ro,
        changelog: changelog.trim() || undefined,
      });
      // The review panel reads the listing, so the refetch has to land before it shows.
      await queryClient.invalidateQueries({ queryKey: ['template-by-base', baseId] });
      return null;
    },
    onSuccess: (data) => {
      // after publish success, clear the uploaded cover, use server data next time
      setUploadedCover(null);
      // Close the publish dialog and show success dialog
      setOpen(false);
      setSuccessDialogOpen(true);
      if (data) {
        const { baseId: templateBaseId, defaultUrl, permalink } = data;
        queryClient.invalidateQueries({ queryKey: ['template-by-base', baseId] });
        // Generate share URL with permalink
        setShareUrl(generateShareUrl(origin, permalink, defaultUrl, templateBaseId));
        // Trigger fireworks effect
        fireConfetti();
      }
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
      // when dialog is closed, reset upload state and fall back to the saved cover preview
      setUploadedCover(null);
      setScreenshotUrl(savedCoverUrl);
      setUploadProgress(0);
      setIsUploading(false);
      setHasLoadedTemplate(false);
    }
  }, [open, savedCoverUrl]);

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
    navigator.clipboard.writeText(displayShareUrl);
    toast.success(t('publishBase.urlCopied'));
  };

  const handleShareToX = () => {
    const text = encodeURIComponent(`Check out this template: ${title}`);
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(displayShareUrl)}`,
      '_blank'
    );
  };

  const handleShareToLinkedIn = () => {
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(displayShareUrl)}`,
      '_blank'
    );
  };

  const handleShareToDiscord = () => {
    // Discord doesn't have a direct share URL, so we just copy the URL
    navigator.clipboard.writeText(displayShareUrl);
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
    publishMutate({ title, description: description || '' });
  }, [title, description, selectedNodeIds, treeItems, publishMutate, t]);

  const publishLabel = publishLabelFor(asTranslate(t), Boolean(submission), templateDetail);

  const handleContinuePublish = useCallback(() => {
    setUnpublishedAppsDialogOpen(false);
    publishMutate({ title, description: description || '' });
  }, [title, description, publishMutate]);

  return (
    <BaseNodeContext.Provider value={nodeContext}>
      <Dialog open={open} onOpenChange={setOpen}>
        {children && <DialogTrigger asChild>{children}</DialogTrigger>}
        <DialogContent className="flex max-h-[90vh] max-w-[1080px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4 text-start">
            <DialogTitle>{t('publishBase.title')}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t('publishBase.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
              <section className="flex flex-col gap-3">
                <div className="text-sm font-semibold">{t('publishBase.infoTitle')}</div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {t('publishBase.form.title')}
                  </Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('publishBase.form.titlePlaceholder')}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {t('publishBase.form.description')}
                  </Label>
                  <Textarea
                    className="min-h-16 resize-y"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('publishBase.form.descriptionPlaceholder')}
                  />
                </div>
                <CoverRow
                  screenshotUrl={screenshotUrl}
                  isUploading={isUploading}
                  uploadProgress={uploadProgress}
                  onPick={handleUploadClick}
                />
              </section>

              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{t('publishBase.form.versionTitle')}</div>
                  {submission && templateDetail && !changelogOpen && !changelog && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => setChangelogOpen(true)}
                    >
                      {t('publishBase.form.addChangelog')}
                    </Button>
                  )}
                </div>
                {(changelogOpen || changelog) && (
                  <TemplateChangelogField
                    template={templateDetail}
                    value={changelog}
                    onChange={setChangelog}
                    focusOnMount={changelogOpen}
                  />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {t('publishBase.form.publishNode')}
                    </Label>
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
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {t('publishBase.form.defaultActiveNode')}
                    </Label>
                    <NodeSelect
                      nodeIds={selectedNodeIds}
                      value={defaultActiveNodeId || ''}
                      onChange={setDefaultActiveNodeId}
                    />
                  </div>
                </div>
                <div className="flex items-center space-x-2 rtl:space-x-reverse">
                  <Switch
                    id="include-data"
                    checked={includeData}
                    onCheckedChange={setIncludeData}
                  />
                  <Label htmlFor="include-data">{t('publishBase.form.includeData')}</Label>
                </div>
              </section>
            </div>

            <aside className="flex w-[380px] shrink-0 flex-col gap-4 overflow-y-auto border-s bg-muted/40 p-5">
              <input
                ref={uploadRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
              <div className="text-sm font-semibold">{t('publishBase.previewTips')}</div>
              <div className="flex flex-col gap-2 rounded-lg border bg-background p-3">
                <CoverPicker
                  screenshotUrl={screenshotUrl}
                  isUploading={isUploading}
                  uploadProgress={uploadProgress}
                  onPick={handleUploadClick}
                  overlay={templateDetail ? host.renderCoverOverlay?.(templateDetail) : null}
                />
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      'truncate text-base font-medium',
                      title ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {title || t('publishBase.form.titlePlaceholder')}
                  </p>
                  {isTemplatePublished && isTemplateFeatured && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            {t('publishBase.featuredLabel')}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent hideWhenDetached={true}>
                          {t('publishBase.featuredTip')}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <p
                  className={cn(
                    'line-clamp-2 text-sm',
                    description ? 'text-muted-foreground' : 'text-foreground/50'
                  )}
                  title={description}
                >
                  {description || t('publishBase.form.descriptionPlaceholder')}
                </p>
                {templateDetail && host.renderCardFooter && (
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    {host.renderCardFooter(templateDetail)}
                  </div>
                )}
              </div>

              <TemplateReviewPanel
                template={templateDetail}
                onWithdraw={withdrawMutate}
                withdrawing={withdrawLoading}
              />
              {!submission && templateDetail?.isPublished && (
                <div className="flex h-9 items-center gap-2 overflow-hidden rounded-md border bg-background ps-3">
                  <Link className="size-4 shrink-0" />
                  <div className="grow truncate text-sm text-muted-foreground">
                    {displayShareUrl}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-9 shrink-0 rounded-none border-s p-0"
                    onClick={handleCopyUrl}
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-9 shrink-0 rounded-none border-s p-0"
                    onClick={() => window.open(displayShareUrl, '_blank')}
                  >
                    <ExternalLink className="size-4" />
                  </Button>
                </div>
              )}
              {templateDetail?.isPublished && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-start text-destructive"
                      disabled={unpublishTemplateLoading}
                    >
                      {t('publishBase.unPublish')}
                      {unpublishTemplateLoading && <Spin className="size-4" />}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('publishBase.unPublishConfirmTitle')}</AlertDialogTitle>
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
            </aside>
          </div>
          <DialogFooter className="border-t px-6 py-3">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handlePublishClick} disabled={publishLoading}>
              <Send className="size-4" />
              {publishLabel}
              {publishLoading && <Spin className="size-4" />}
            </Button>
          </DialogFooter>
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
          {submission ? (
            <>
              <DialogHeader className="flex h-[60px] flex-col justify-center px-6">
                <DialogTitle className="text-start text-lg font-semibold">
                  {t('publishBase.submitted')}
                </DialogTitle>
              </DialogHeader>
              <TemplateReviewPanel
                className="px-6 pb-6"
                template={templateDetail}
                onWithdraw={withdrawMutate}
                withdrawing={withdrawLoading}
              />
            </>
          ) : (
            <>
              <DialogHeader className="flex h-[60px] flex-col justify-center px-6">
                <DialogTitle className="text-start text-lg font-semibold">
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
                    <div className="flex-1 truncate">{displayShareUrl}</div>
                  </div>
                  <Button size="icon" variant="outline" onClick={handleCopyUrl}>
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => window.open(displayShareUrl, '_blank')}
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
            </>
          )}
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
    </BaseNodeContext.Provider>
  );
};

const publishLabelFor = (
  t: ITranslate,
  reviewed: boolean,
  template: { isPublished?: boolean; version: number } | null | undefined
) => {
  if (!reviewed) return t(template ? 'publishBase.update' : 'publishBase.publish');
  if (!template?.isPublished) return t('publishBase.submit');
  return t('publishBase.submitVersion', { version: template.version + 1 });
};

interface ICoverProps {
  screenshotUrl: string | undefined;
  isUploading: boolean;
  uploadProgress: number;
  onPick: () => void;
}

const CoverRow = ({ screenshotUrl, isUploading, uploadProgress, onPick }: ICoverProps) => {
  const { t } = useTranslation('space');
  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed px-3 py-2.5">
      {screenshotUrl ? (
        <img src={screenshotUrl} className="h-14 w-24 shrink-0 rounded object-cover" alt="cover" />
      ) : (
        <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded bg-muted">
          {isUploading ? (
            <Spin className="size-5" />
          ) : (
            <Plus className="size-5 text-muted-foreground" />
          )}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm">{t('publishBase.form.cover')}</span>
        <span className="text-xs text-muted-foreground">
          {isUploading ? `${uploadProgress}%` : t('publishBase.form.coverHint')}
        </span>
      </div>
      <Button size="sm" variant="outline" onClick={onPick} disabled={isUploading}>
        <Camera className="size-4" />
        {screenshotUrl ? t('publishBase.changeCover') : t('publishBase.uploadCover')}
      </Button>
    </div>
  );
};

const CoverPicker = ({
  screenshotUrl,
  isUploading,
  uploadProgress,
  onPick,
  overlay,
}: ICoverProps & { overlay: React.ReactNode }) => {
  const { t } = useTranslation('space');
  return (
    <div
      className="group relative aspect-video cursor-pointer overflow-hidden rounded-md bg-muted"
      onClick={onPick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onPick();
        }
      }}
    >
      {screenshotUrl ? (
        <>
          <img
            src={screenshotUrl}
            className="size-full object-cover"
            alt="published project preview"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <div className="flex flex-col items-center gap-2">
              <Camera className="size-8 text-white" />
              <span className="text-sm text-white">{t('publishBase.changeCover')}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 transition-colors hover:bg-black/5 dark:hover:bg-white/10">
          {isUploading ? (
            <>
              <Spin className="size-8" />
              <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
            </>
          ) : (
            <>
              <Plus className="size-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t('publishBase.uploadCover')}</span>
            </>
          )}
        </div>
      )}
      {overlay && <div className="absolute bottom-2 start-2">{overlay}</div>}
    </div>
  );
};
