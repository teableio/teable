import type { IBaseNodeAppResourceMeta } from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { useBase } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib';
import {
  Button,
  cn,
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
import type { TreeItemData } from '../../../base/base-node/hooks';

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
      <DialogContent className="max-w-[480px]">
        <DialogHeader className="flex flex-row items-start gap-4 space-y-0 text-left">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <AlertTriangle className="size-5 text-amber-600 dark:text-amber-500" />
          </div>
          <div className="flex flex-col gap-1.5 pt-0.5">
            <DialogTitle className="leading-none">
              {t('publishBase.unpublishedApps.title')}
            </DialogTitle>
            <DialogDescription className="text-sm leading-normal text-muted-foreground">
              {t('publishBase.unpublishedApps.description')}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="my-4 flex max-h-[400px] flex-col gap-2 overflow-auto">
          {apps.map((app) => {
            const node = treeItems[app.nodeId];
            const nodeName =
              node?.resourceMeta?.name || app.name || t('publishBase.unpublishedApps.unnamedApp');

            return (
              <div
                key={app.nodeId}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3',
                  app.isPublished &&
                    'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950',
                  app.error && 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{nodeName}</div>
                  {app.error && <div className="truncate text-xs text-red-600">{app.error}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {app.isPublished ? (
                    <div className="flex items-center gap-1 text-green-600">
                      <Check className="size-4 shrink-0" />
                      <span className="text-xs">{t('publishBase.unpublishedApps.published')}</span>
                    </div>
                  ) : app.isPublishing ? (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                      <span className="text-xs">{t('publishBase.unpublishedApps.publishing')}</span>
                    </div>
                  ) : app.error ? (
                    <>
                      {canPublish && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => handlePublishApp(app)}
                          className="h-7 shrink-0 gap-1 px-2"
                        >
                          <Rocket className="size-3 shrink-0" />
                          <span className="truncate">
                            {t('publishBase.unpublishedApps.redeploy')}
                          </span>
                        </Button>
                      )}
                      {baseId && (
                        <Button
                          size="xs"
                          variant="outline"
                          className="h-7 shrink-0 gap-1 px-2"
                          asChild
                        >
                          <Link href={`/base/${baseId}/app/${app.resourceId}`} target="_blank">
                            <ExternalLink className="size-3 shrink-0" />
                            <span className="truncate">
                              {t('publishBase.unpublishedApps.goToFix')}
                            </span>
                          </Link>
                        </Button>
                      )}
                    </>
                  ) : canPublish ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => handlePublishApp(app)}
                      className="h-7 gap-1"
                    >
                      <Rocket className="size-3" />
                      {t('publishBase.unpublishedApps.publish')}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t('publishBase.unpublishedApps.notPublished')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {canPublish && (
            <Button
              onClick={handlePublishAllApps}
              disabled={allPublished || somePublishing || isPublishingAll}
              className="gap-1"
            >
              <Rocket className="size-4" />
              {t('publishBase.unpublishedApps.publishAll')}
              {(somePublishing || isPublishingAll) && <Spin className="ml-1 size-4" />}
            </Button>
          )}
          <div className="flex flex-1 justify-end gap-2">
            <Button
              variant="ghost"
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
          </div>
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
      // Check if app is not published (no publicUrl or no publishedVersion)
      if (!resourceMeta?.publicUrl || !resourceMeta?.publishedVersion) {
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
