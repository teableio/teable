import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateAttachmentId } from '@teable/core';
import { Link, Plus } from '@teable/icons';
import type {
  ITemplateCoverRo,
  INotifyVo,
  IPublishBaseRo,
  IGetBaseVo,
  ITemplateVo,
} from '@teable/openapi';
import {
  getBaseNodeTree,
  getTemplateByBaseId,
  publishBase,
  unpublishTemplate,
  UploadType,
  BaseNodeResourceType,
  isTemplateLive,
  isUnreleasedSubmission,
  ShortLinkType,
} from '@teable/openapi';
import { AttachmentManager } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { SessionContext } from '@teable/sdk/context';
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
  Textarea,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import confetti from 'canvas-confetti';
import { noop } from 'lodash';
import { Camera, ChevronLeft, Copy, ExternalLink, Send } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState, useRef, useEffect, useMemo, useCallback, useContext } from 'react';
import {
  TemplateHostContext,
  useTemplateSubmitTerms,
  type ITemplateSubmitTerms,
} from '@/features/app/components/space/template/host-context';
import { TemplateCard } from '@/features/app/components/space/template/TemplateCard';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { useOrigin } from '@/features/app/hooks/useOrigin';
import { useShortLink } from '@/features/app/hooks/useShortLink';
import { asTranslate, type ITranslate } from '@/features/app/utils/translate';
import { BaseNodeContext } from '../../../base/base-node/BaseNodeContext';
import { buildTreeItems, filterAutoHiddenFolders, ROOT_ID } from '../../../base/base-node/hooks';
import { useAppPublishContext } from './AppPublishContext';
import { normalizeCheckedItems } from './node-tree-check';
import { NodeSelect } from './NodeSelect';
import { usePublishDraft } from './publish-draft';
import { PublishTimelinePage } from './PublishVersionTimeline';
import type { IPublishTimelineProps } from './PublishVersionTimeline';
import {
  IncludeDataSwitch,
  PublishScopeField,
  publishScopeOf,
  useTemplateProjectPublish,
} from './TemplateProjectPublish';
import { TemplateShareButtons } from './TemplateShareButtons';
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
  /**
   * `dialog` (default): a dialog, the preview beside the form. `page`: a page of its own, the
   * template's versions on one line with the next one's checklist (the chat-first shell's
   * publish tab).
   */
  variant?: 'dialog' | 'page';
  closeOnSuccess?: boolean;
  /** A page shown in place of the project's nodes (the classic shell): the way back to them. */
  onBack?: () => void;
  // Controlled mode, for callers that must not mount the dialog inside a dropdown menu
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const useControllableOpen = (open?: boolean, onOpenChange?: (open: boolean) => void) => {
  const [innerOpen, setInnerOpen] = useState(false);
  return [open ?? innerOpen, onOpenChange ?? setInnerOpen] as const;
};

/**
 * A page is open for as long as it is shown: what would close the dialog (publishing, fixing a
 * finding, editing the guide) leaves it where it is.
 */
const usePublishOpen = (
  page: boolean,
  open?: boolean,
  onOpenChange?: (open: boolean) => void
): readonly [boolean, (open: boolean) => void] => {
  const [dialogOpen, setDialogOpen] = useControllableOpen(open, onOpenChange);
  return page ? [true, noop] : [dialogOpen, setDialogOpen];
};

/** Publish's icon, a spinner while it publishes, so the button keeps its width. */
const PublishIcon = ({ loading }: { loading: boolean }) =>
  loading ? <Spin className="size-4" /> : <Send />;

export const PublishBaseDialog = (props: IPublishBaseDialogProps) => {
  const { base, children, onClose, closeOnSuccess = false } = props;
  const { t } = useTranslation(['space', 'common']);
  const baseId = base.id;
  const isPage = props.variant === 'page';
  const [open, setOpen] = usePublishOpen(isPage, props.open, props.onOpenChange);
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
  // Who publishes it, for the preview's third line; absent where no session is provided.
  const sessionUser = useContext(SessionContext)?.user;
  const terms = useTemplateSubmitTerms(open && Boolean(submission));
  const termsNudge = useTermsNudge(terms, open);

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

  const resourceCount = useMemo(
    () =>
      allNodeIds.filter((id) => treeItems[id]?.resourceType !== BaseNodeResourceType.Folder).length,
    [allNodeIds, treeItems]
  );

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  // The page keeps what was typed or uploaded until it is published; the dialog starts afresh.
  const draft = usePublishDraft(isPage, baseId, base.name ?? '');
  const keepDraft = draft.keep;
  const [title, setTitle] = useState(draft.initial.title);
  const [description, setDescription] = useState<string | undefined>(draft.initial.description);
  const [changelog, setChangelog] = useState(draft.initial.changelog);
  const [screenshotUrl, setScreenshotUrl] = useState<string | undefined>(
    draft.initial.cover?.presignedUrl
  );
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedCover, setUploadedCover] = useState<
    | (INotifyVo & {
        id: string;
        name: string;
      })
    | null
  >(draft.initial.cover);
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

  const { data: templateDetail, isLoading: templateLoading } = useQuery({
    queryKey: ['template-by-base', baseId],
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => getTemplateByBaseId(baseId).then((res) => res.data),
    enabled: open,
  });
  const live = isTemplateLive(templateDetail);
  // A template project goes out whole, with the sample records it holds.
  const project = useTemplateProjectPublish({
    baseId,
    open,
    close: () => setOpen(false),
  });
  const publishedNodeIds = publishScopeOf(project.isTemplateProject, allNodeIds, selectedNodeIds);
  const shipsRecords = publishScopeOf(project.isTemplateProject, true, includeData);
  const savedCoverUrl = templateDetail?.cover?.presignedUrl || undefined;
  const origin = useOrigin();

  // Prefer the short URL when sharing a published template, listed or not (or a submission from
  // before publishing went live on submit, which its link opens); only fall back to the
  // permalink when short link creation failed (empty while loading)
  const { shortUrl, isFallback } = useShortLink(
    (isTemplateLive(templateDetail) || isUnreleasedSubmission(templateDetail)) && templateDetail?.id
      ? { type: ShortLinkType.Template, resourceId: templateDetail.id }
      : undefined
  );
  const displayShareUrl = shortUrl ?? (isFallback ? shareUrl : '');

  // Handle template data changes (replaces onSuccess callback removed in React Query v5)
  useEffect(() => {
    if (!templateDetail) return;

    // What the author has typed and not yet published wins over what was published last.
    const unpublished = draft.read();
    setTitle(unpublished.title ?? (templateDetail?.name || base.name || ''));
    setDescription(unpublished.description ?? templateDetail?.description);
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
  }, [templateDetail, base.name, uploadedCover, origin, savedCoverUrl, draft]);

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
      nodes: publishScopeOf(
        project.isTemplateProject,
        undefined,
        selectedNodeIds.length > 0 &&
          (base.restrictedAuthority || !allNodeIds.every((id) => selectedNodeIds.includes(id)))
          ? selectedNodeIds
          : undefined
      ),
      includeData: shipsRecords,
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
        agreeTerms: terms.agreed || undefined,
      });
      // The review panel reads the listing, so the refetch has to land before it shows.
      await queryClient.invalidateQueries({ queryKey: ['template-by-base', baseId] });
      return null;
    },
    onSuccess: (data) => {
      // after publish success, clear the uploaded cover, use server data next time
      setUploadedCover(null);
      draft.clear();
      // Close the publish dialog and show success dialog; on the page, leave the next version's
      // notes blank.
      setOpen(false);
      setChangelog('');
      setSuccessDialogOpen(true);
      // Published either way: a submission goes live the moment it is made.
      fireConfetti();
      if (data) {
        const { baseId: templateBaseId, defaultUrl, permalink } = data;
        queryClient.invalidateQueries({ queryKey: ['template-by-base', baseId] });
        // Generate share URL with permalink
        setShareUrl(generateShareUrl(origin, permalink, defaultUrl, templateBaseId));
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
          const cover = { ...result, id: attachmentId, name: fileName };
          setScreenshotUrl(result.presignedUrl);
          setUploadedCover(cover);
          keepDraft({ cover });
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

    // A submission is what a shared link previews: it needs a cover
    if (submission && !uploadedCover && !savedCoverUrl) {
      toast.error(t('publishBase.tips.coverRequired'));
      return;
    }

    if (publishedNodeIds.length === 0) {
      toast.error(t('publishBase.tips.atLeastOneNode'));
      return;
    }

    // Check for unpublished app nodes
    const unpublishedAppNodes = getUnpublishedAppNodes(publishedNodeIds, treeItems);
    if (unpublishedAppNodes.length > 0) {
      setUnpublishedApps(unpublishedAppNodes);
      setExternalApps(undefined); // Reset external apps state
      setUnpublishedAppsDialogOpen(true);
      return;
    }

    // No unpublished apps, proceed with publishing
    publishMutate({ title, description: description || '' });
  }, [
    title,
    description,
    submission,
    uploadedCover,
    savedCoverUrl,
    publishedNodeIds,
    treeItems,
    publishMutate,
    t,
  ]);

  const publishLabel = publishLabelFor(asTranslate(t), Boolean(submission), templateDetail);

  const handleContinuePublish = useCallback(() => {
    setUnpublishedAppsDialogOpen(false);
    publishMutate({ title, description: description || '' });
  }, [title, description, publishMutate]);

  // The form, the catalogue preview, where the listing stands and the publish bar: drawn as a
  // dialog with the preview beside the form, or laid out on the page's version line.
  const cardFields = (
    <>
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <ListingFields
        page={isPage}
        coverRequired={Boolean(submission)}
        cover={
          <CoverPicker
            screenshotUrl={screenshotUrl}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            onPick={handleUploadClick}
          />
        }
        title={title}
        onTitleChange={(value) => {
          setTitle(value);
          keepDraft({ title: value });
        }}
        description={description ?? ''}
        onDescriptionChange={(value) => {
          setDescription(value);
          keepDraft({ description: value });
        }}
      />
    </>
  );
  const scopeFields = (
    <>
      {/* A template project ships all of itself, so only where it opens is left to choose. */}
      <div className={cn('grid gap-4', !project.isTemplateProject && 'sm:grid-cols-2')}>
        {!project.isTemplateProject && (
          <div className="flex flex-col gap-2">
            <Label className="leading-5">{t('publishBase.form.publishNode')}</Label>
            <PublishScopeField
              wholeProject={false}
              count={resourceCount}
              records={project.records}
              checkedItems={selectedNodeIds}
              onCheckedItemsChange={setSelectedNodeIds}
              totalNodeCount={allNodeIds.length}
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label className="leading-5">{t('publishBase.form.defaultActiveNode')}</Label>
          <NodeSelect
            className="bg-background"
            nodeIds={publishedNodeIds}
            value={defaultActiveNodeId || ''}
            onChange={setDefaultActiveNodeId}
          />
        </div>
      </div>
      <IncludeDataSwitch
        hidden={project.isTemplateProject}
        checked={includeData}
        onCheckedChange={setIncludeData}
      />
    </>
  );
  // Notes for whoever installed it: there is only someone to tell once a version is live.
  const changeChangelog = (value: string) => {
    setChangelog(value);
    keepDraft({ changelog: value });
  };
  const changelogField = live && (
    <TemplateChangelogField
      template={templateDetail}
      value={changelog}
      onChange={changeChangelog}
    />
  );
  const guideRow = submission?.renderGuideRow?.({
    baseId,
    includeData: shipsRecords,
    close: () => setOpen(false),
  });
  const formFields = (
    <>
      {cardFields}
      {scopeFields}
      {changelogField}
      {guideRow}
    </>
  );
  // A submission is what a shared link previews: it needs a cover.
  const hasCover = !submission || Boolean(uploadedCover || savedCoverUrl);
  // The page's button waits for what the card still lacks, marked on its fields; the dialog says
  // so when the button is pressed.
  const waitsForListing = pageWaitsForListing({ page: isPage, title, description, hasCover });
  // Everything the author sets is on the page's left; the side column only shows.
  const listing = (
    <>
      {cardFields}
      {scopeFields}
    </>
  );
  // Each section of the side column: its heading outside, what it holds in a card under it.
  const previewTemplate = previewTemplateOf({
    template: templateDetail,
    // A required field left empty says so where it would show, rather than leaving a gap.
    title: title.trim() ? title : t('publishBase.preview.titleMissing'),
    description: description?.trim() ? description : t('publishBase.preview.descriptionMissing'),
    coverUrl: screenshotUrl,
    user: sessionUser,
  });
  const previewCard = (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium leading-5">{t('publishBase.previewTips')}</h3>
      {/* A picture of the card, not one to open: it takes no clicks or focus. */}
      <div className="rounded-lg border bg-background p-3" inert>
        <ClientOnly>
          <TemplateCard template={previewTemplate} size="sm" />
        </ClientOnly>
      </div>
    </section>
  );
  const reviewPanel = (
    <TemplateReviewPanel
      template={templateDetail}
      onWithdraw={withdrawMutate}
      withdrawing={withdrawLoading}
      shareUrl={displayShareUrl}
    />
  );
  const legacyStatus = (
    <>
      {!submission && templateDetail?.isPublished && (
        <div className="flex h-9 items-center gap-2 overflow-hidden rounded-md border bg-background ps-3">
          <Link className="size-4 shrink-0" />
          <div className="grow truncate text-sm text-muted-foreground">{displayShareUrl}</div>
          <Button
            size="icon"
            variant="ghost"
            className="h-full w-9 shrink-0 rounded-none border-s p-0"
            aria-label={t('common:actions.copyLink')}
            title={t('common:actions.copyLink')}
            onClick={handleCopyUrl}
          >
            <Copy className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-full w-9 shrink-0 rounded-none border-s p-0"
            aria-label={t('common:actions.openLink')}
            title={t('common:actions.openLink')}
            onClick={() => window.open(displayShareUrl, '_blank')}
          >
            <ExternalLink className="size-4" />
          </Button>
        </div>
      )}
      {!submission && templateDetail?.isPublished && (
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
    </>
  );
  const statusPanels = (
    <>
      {project.checks}
      {legacyStatus}
    </>
  );
  const termsBar = (
    <>
      {terms.panel && (
        <div
          ref={termsNudge.ref}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:me-auto"
        >
          {terms.panel}
          {termsNudge.showHint && (
            <span role="alert" className="text-xs text-destructive">
              {t('publishBase.agreeTermsFirst')}
            </span>
          )}
        </div>
      )}
    </>
  );
  // Unagreed terms don't grey the button out: pressing it says what is missing.
  const publishButton = (
    <Button
      onClick={() => termsNudge.guard(handlePublishClick)}
      disabled={publishLoading || project.blocked || termsNudge.waiting || waitsForListing}
    >
      <PublishIcon loading={publishLoading} />
      {publishLabel}
    </Button>
  );
  const header = (
    <PublishHeading
      page={isPage}
      title={project.title}
      description={project.description}
      onBack={props.onBack}
    />
  );

  const slots = {
    header,
    formFields,
    previewCard,
    reviewPanel,
    statusPanels,
    termsBar,
    publishButton,
  };

  return (
    <BaseNodeContext.Provider value={nodeContext}>
      <PublishFrame
        page={isPage}
        timeline={{
          header,
          loading: templateLoading,
          pending: project.pending,
          template: templateDetail,
          listing,
          listingSummary: {
            title,
            description,
            coverUrl: screenshotUrl,
            complete: !pageWaitsForListing({ page: true, title, description, hasCover }),
          },
          checks: project.rows,
          guideRow,
          changelogField,
          termsBar,
          publishButton,
          reviewPanel,
          liveActionsElsewhere: project.isTemplateProject,
          extra: legacyStatus,
          previewCard,
          contents: project.contents,
        }}
        dialog={{
          ...slots,
          open,
          onOpenChange: setOpen,
          trigger: children,
          cancelLabel: t('common:actions.cancel'),
        }}
      />

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
                  {t('publishBase.publishSuccess')}
                </DialogTitle>
              </DialogHeader>
              <TemplateReviewPanel
                className="px-6 pb-6"
                showName
                showHistory={false}
                template={templateDetail}
                shareUrl={displayShareUrl}
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

                {isCloud && displayShareUrl && (
                  <div className="pt-6">
                    <TemplateShareButtons title={title} shareUrl={displayShareUrl} />
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

/**
 * On the page, the card cannot go out yet: it has no name, no description, or no cover where one
 * is needed. Never in the dialog, which says what is missing when its button is pressed.
 */
const pageWaitsForListing = ({
  page,
  title,
  description,
  hasCover,
}: {
  page: boolean;
  title: string;
  description: string | undefined;
  hasCover: boolean;
}) => page && (!title.trim() || !description?.trim() || !hasCover);

const publishLabelFor = (
  t: ITranslate,
  reviewed: boolean,
  template: (Parameters<typeof isTemplateLive>[0] & { version: number }) | null | undefined
) => {
  if (!reviewed) return t(template ? 'publishBase.update' : 'publishBase.publish');
  if (!template || !isTemplateLive(template)) return t('publishBase.submit');
  return t('publishBase.submitVersion', { version: template.version + 1 });
};

interface IPublishSlots {
  header: React.ReactNode;
  formFields: React.ReactNode;
  previewCard: React.ReactNode;
  /** Where the listing stands, its link and its share buttons, once there is one. */
  reviewPanel: React.ReactNode;
  statusPanels: React.ReactNode;
  termsBar: React.ReactNode;
  publishButton: React.ReactNode;
}

/**
 * The publish dialog: side by side from md up, what is set on the left and how the catalogue will
 * show it on the right. On a narrow screen the preview goes below the form and the two scroll as one.
 */
const PublishDialogFrame = ({
  header,
  formFields,
  previewCard,
  reviewPanel,
  statusPanels,
  termsBar,
  publishButton,
  open,
  onOpenChange,
  trigger,
  cancelLabel,
}: IPublishSlots & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: React.ReactNode;
  cancelLabel: string;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
    <DialogContent className="flex max-h-[90vh] max-w-[1080px] flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="border-b px-6 py-4 text-start">{header}</DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col gap-5 px-6 py-5 md:overflow-y-auto">
          {formFields}
        </div>
        <aside className="flex w-full shrink-0 flex-col gap-4 border-t bg-muted p-5 md:w-[380px] md:overflow-y-auto md:border-s md:border-t-0">
          {previewCard}
          {reviewPanel}
          {statusPanels}
        </aside>
      </div>
      <DialogFooter className="items-center border-t px-6 py-3">
        {termsBar}
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {cancelLabel}
        </Button>
        {publishButton}
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/**
 * The publish form in its frame: the dialog everywhere but the chat-first shell's tab, which
 * lays the same parts out on the template's version line.
 */
const PublishFrame = ({
  page,
  timeline,
  dialog,
}: {
  page: boolean;
  timeline: IPublishTimelineProps;
  dialog: React.ComponentProps<typeof PublishDialogFrame>;
}) => (page ? <PublishTimelinePage {...timeline} /> : <PublishDialogFrame {...dialog} />);

const PublishBackButton = ({ onBack }: { onBack: () => void }) => {
  const { t } = useTranslation('common');
  return (
    <Button
      variant="ghost"
      size="icon"
      className="-ms-2 shrink-0"
      aria-label={t('actions.back')}
      onClick={onBack}
    >
      <ChevronLeft className="size-4" />
    </Button>
  );
};

/** The title and what publishing does: the dialog's own, or a page's heading. */
const PublishHeading = ({
  page,
  title,
  description,
  onBack,
}: {
  page: boolean;
  title: React.ReactNode;
  description: React.ReactNode;
  onBack?: () => void;
}) =>
  page ? (
    <div className="flex items-center gap-2">
      {onBack && <PublishBackButton onBack={onBack} />}
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  ) : (
    <>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription className="text-sm text-muted-foreground">{description}</DialogDescription>
    </>
  );

/** Pressing publish before agreeing to the terms points at them, instead of a greyed-out button. */
const useTermsNudge = (terms: ITemplateSubmitTerms, open: boolean) => {
  const ref = useRef<HTMLDivElement>(null);
  const [nudged, setNudged] = useState(false);
  useEffect(() => {
    if (!open) setNudged(false);
  }, [open]);
  const pointable = terms.blocked && Boolean(terms.panel);
  return {
    ref,
    showHint: nudged && terms.blocked,
    // Still finding out whether there are terms at all: nothing to point at yet.
    waiting: terms.blocked && !terms.panel,
    guard: (publish: () => void) => {
      if (!pointable) return publish();
      setNudged(true);
      ref.current?.querySelector<HTMLElement>('button, input')?.focus();
    },
  };
};

/**
 * Drawn once in the browser: the publish page is also rendered on the server, which the card's
 * own translations are not loaded for, and the preview only means anything as it is edited.
 */
const ClientOnly = ({ children }: { children: React.ReactNode }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? children : null;
};

/**
 * The card exactly as the template centre lists it, made of what is set now: no loading shapes
 * for what is not filled in yet, and its maker and installs on the third line (the author and
 * none before it is published).
 */
const previewTemplateOf = ({
  template,
  title,
  description,
  coverUrl,
  user,
}: {
  template: ITemplateVo | null | undefined;
  title: string;
  description: string | undefined;
  coverUrl: string | undefined;
  user: { id: string; name: string; avatar?: string | null } | undefined;
}): ITemplateVo =>
  ({
    ...template,
    id: template?.id ?? '',
    name: title,
    description: description ?? '',
    cover: coverUrl ? { presignedUrl: coverUrl } : null,
    createdBy:
      template?.createdBy ??
      (user ? { id: user.id, name: user.name, avatar: user.avatar } : undefined),
    usageCount: template?.usageCount ?? 0,
    visitCount: template?.visitCount ?? 0,
  }) as ITemplateVo;

/**
 * What the catalogue card is made of: the cover beside the words that go on it in the dialog;
 * one under another on the page, under the checklist line they belong to.
 */
const ListingFields = ({
  page,
  coverRequired,
  cover,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
}: {
  page: boolean;
  coverRequired: boolean;
  cover: React.ReactNode;
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
}) => {
  const { t } = useTranslation('space');
  return (
    <div className={cn('flex flex-col gap-4', !page && 'sm:flex-row')}>
      <div className={cn('flex shrink-0 flex-col gap-2', page ? 'w-64 max-w-full' : 'sm:w-44')}>
        <Label className="leading-5">
          {t('publishBase.form.cover')}
          {coverRequired && <RequiredMark />}
        </Label>
        {cover}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="publish-title" className="leading-5">
            {t('publishBase.form.title')}
            <RequiredMark />
          </Label>
          <Input
            id="publish-title"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={t('publishBase.form.titlePlaceholder')}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="publish-description" className="leading-5">
            {t('publishBase.form.description')}
            <RequiredMark />
          </Label>
          <Textarea
            id="publish-description"
            className="min-h-24 resize-y"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={t('publishBase.form.descriptionPlaceholder')}
          />
        </div>
      </div>
    </div>
  );
};

/** Name, description and cover: a template can't go out without them. */
const RequiredMark = () => (
  <span className="ms-1 text-destructive" aria-hidden="true">
    *
  </span>
);

interface ICoverPickerProps {
  screenshotUrl: string | undefined;
  isUploading: boolean;
  uploadProgress: number;
  onPick: () => void;
}

/** The one place to pick the cover, beside the words that go on the card. */
const CoverPicker = ({ screenshotUrl, isUploading, uploadProgress, onPick }: ICoverPickerProps) => {
  const { t } = useTranslation('space');
  // A cover whose image cannot be read shows as no picture, not as the browser's broken image.
  const [failedUrl, setFailedUrl] = useState<string>();
  const shown = Boolean(screenshotUrl) && failedUrl !== screenshotUrl;
  return (
    <button
      type="button"
      // picking again while an upload runs would start a second one
      disabled={isUploading}
      id="publish-cover"
      onClick={onPick}
      aria-label={t(screenshotUrl ? 'publishBase.changeCover' : 'publishBase.uploadCover')}
      className={cn(
        'group relative aspect-[16/10] w-full overflow-hidden rounded-md border bg-background text-muted-foreground transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
        // Dashed is the empty drop target; a picture gets the plain edge the inputs have.
        shown ? 'border-solid' : 'border-dashed'
      )}
    >
      {shown ? (
        <>
          <img
            src={screenshotUrl}
            className="size-full object-cover"
            alt=""
            onError={() => setFailedUrl(screenshotUrl)}
          />
          {!isUploading && (
            // The dialog overlay's scrim, the same in light and dark: it lies over a picture. Laid
            // out as the empty cover is, the icon above its label.
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Camera className="size-5" />
              {t('publishBase.changeCover')}
            </span>
          )}
        </>
      ) : (
        !isUploading && (
          <span className="flex size-full flex-col items-center justify-center gap-1 text-xs">
            {screenshotUrl ? <Camera className="size-5" /> : <Plus className="size-5" />}
            {t(screenshotUrl ? 'publishBase.changeCover' : 'publishBase.uploadCover')}
          </span>
        )
      )}
      {isUploading && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/70 text-xs">
          <Spin className="size-5" />
          {uploadProgress}%
        </span>
      )}
    </button>
  );
};
