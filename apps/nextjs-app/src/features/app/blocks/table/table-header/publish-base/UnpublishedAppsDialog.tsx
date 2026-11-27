import type { IBaseNodeAppResourceMeta } from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { useBase } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { AlertTriangle, Check, ExternalLink, Loader2, Rocket } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useState, useEffect } from 'react';
import { BaseNodeResourceIconMap } from '../../../base/base-node/hooks';
import type { TreeItemData } from '../../../base/base-node/hooks';

const AppIcon = BaseNodeResourceIconMap[BaseNodeResourceType.App];

export interface IUnpublishedApp {
  nodeId: string;
  name: string;
  resourceId: string;
  isPublishing?: boolean;
  isPublished?: boolean;
  error?: string;
}

interface IUnpublishedAppsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unpublishedApps: IUnpublishedApp[];
  treeItems: Record<string, TreeItemData>;
  onContinue: () => void;
  // Optional publish handler - if not provided, publish buttons won't be shown
  onPublishApp?: (app: IUnpublishedApp) => Promise<void>;
  // Allow external control of app states (for EE polling)
  externalApps?: IUnpublishedApp[];
}

export const UnpublishedAppsDialog = (props: IUnpublishedAppsDialogProps) => {
  const {
    open,
    onOpenChange,
    unpublishedApps: initialApps,
    treeItems,
    onContinue,
    onPublishApp,
    externalApps,
  } = props;
  const { t } = useTranslation(['space', 'common']);
  const base = useBase();
  const baseId = base?.id;

  const [apps, setApps] = useState<IUnpublishedApp[]>(initialApps);
  const [isPublishingAll, setIsPublishingAll] = useState(false);

  // Update apps when initialApps changes
  useEffect(() => {
    setApps(initialApps);
  }, [initialApps]);

  // Allow external control of app states (for EE polling updates)
  useEffect(() => {
    if (externalApps) {
      setApps(externalApps);
    }
  }, [externalApps]);

  const handlePublishApp = async (app: IUnpublishedApp) => {
    if (!onPublishApp) return;

    setApps((prev) =>
      prev.map((a) =>
        a.resourceId === app.resourceId ? { ...a, isPublishing: true, error: undefined } : a
      )
    );

    try {
      await onPublishApp(app);
      // Update state to published on success
      setApps((prev) =>
        prev.map((a) =>
          a.resourceId === app.resourceId
            ? { ...a, isPublishing: false, isPublished: true, error: undefined }
            : a
        )
      );
    } catch {
      setApps((prev) =>
        prev.map((a) =>
          a.resourceId === app.resourceId
            ? { ...a, isPublishing: false, error: t('publishBase.unpublishedApps.publishFailed') }
            : a
        )
      );
    }
  };

  const handlePublishAllApps = async () => {
    const unpublishedList = apps.filter((app) => !app.isPublished && !app.isPublishing);

    setIsPublishingAll(true);
    try {
      // Trigger all deploys in parallel for better performance
      await Promise.all(unpublishedList.map((app) => handlePublishApp(app)));
    } finally {
      setIsPublishingAll(false);
    }
  };

  const allPublished = apps.every((app) => app.isPublished);
  const somePublishing = apps.some((app) => app.isPublishing);
  const canPublish = Boolean(onPublishApp);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] gap-5">
        <DialogHeader className="flex flex-row items-start gap-3 space-y-0 text-start">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/10">
            <AlertTriangle className="size-5 text-warning" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle className="text-base leading-6">
              {t('publishBase.unpublishedApps.title')}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t('publishBase.unpublishedApps.description')}
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* One list, every line the same height whatever it is doing, so the dialog never moves. */}
        <ul className="max-h-[400px] divide-y overflow-auto rounded-lg border">
          {apps.map((app) => {
            const node = treeItems[app.nodeId];
            const nodeName =
              node?.resourceMeta?.name || app.name || t('publishBase.unpublishedApps.unnamedApp');

            return (
              <li key={app.nodeId} className="flex h-11 items-center gap-2 px-3">
                <AppIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{nodeName}</span>
                <div className="flex h-7 shrink-0 items-center gap-1.5 text-xs">
                  {app.isPublished ? (
                    <span className="flex items-center gap-1 text-success">
                      <Check className="size-4 shrink-0" />
                      {t('publishBase.unpublishedApps.published')}
                    </span>
                  ) : app.isPublishing ? (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                      {t('publishBase.unpublishedApps.publishing')}
                    </span>
                  ) : app.error ? (
                    <>
                      {/* The reason is kept on hover: a second line would grow the dialog. */}
                      <span className="max-w-32 truncate text-destructive" title={app.error}>
                        {app.error}
                      </span>
                      {canPublish && (
                        <Button size="xs" variant="outline" onClick={() => handlePublishApp(app)}>
                          <Rocket className="size-3 shrink-0" />
                          {t('publishBase.unpublishedApps.redeploy')}
                        </Button>
                      )}
                      {baseId && (
                        <Button size="xs" variant="outline" asChild>
                          <Link href={`/base/${baseId}/app/${app.resourceId}`} target="_blank">
                            <ExternalLink className="size-3 shrink-0" />
                            {t('publishBase.unpublishedApps.goToFix')}
                          </Link>
                        </Button>
                      )}
                    </>
                  ) : canPublish ? (
                    <Button size="xs" variant="outline" onClick={() => handlePublishApp(app)}>
                      <Rocket className="size-3" />
                      {t('publishBase.unpublishedApps.publish')}
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">
                      {t('publishBase.unpublishedApps.notPublished')}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {/* The main action ends the row: publishing them all, or going on once they all are. */}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={somePublishing || isPublishingAll}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={onContinue}
            disabled={somePublishing || isPublishingAll}
            variant={allPublished ? 'default' : 'outline'}
          >
            {allPublished
              ? t('common:actions.continue')
              : t('publishBase.unpublishedApps.ignoreAndContinue')}
          </Button>
          {canPublish && !allPublished && (
            <Button
              onClick={handlePublishAllApps}
              disabled={somePublishing || isPublishingAll}
              className="gap-1"
            >
              <Rocket className="size-4" />
              {t('publishBase.unpublishedApps.publishAll')}
              {(somePublishing || isPublishingAll) && <Spin className="ms-1 size-4" />}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Helper function to get unpublished app nodes
export const getUnpublishedAppNodes = (
  selectedNodeIds: string[],
  treeItems: Record<string, TreeItemData>
): IUnpublishedApp[] => {
  const unpublishedApps: IUnpublishedApp[] = [];

  selectedNodeIds.forEach((nodeId) => {
    const node = treeItems[nodeId];
    if (node && node.resourceType === BaseNodeResourceType.App) {
      const resourceMeta = node.resourceMeta as IBaseNodeAppResourceMeta;
      // Not published: no public URL, or no published version (version 0 is a published one)
      if (!resourceMeta?.publicUrl || typeof resourceMeta?.publishedVersion !== 'number') {
        unpublishedApps.push({
          nodeId,
          name: resourceMeta?.name || '',
          resourceId: node.resourceId,
        });
      }
    }
  });

  return unpublishedApps;
};
