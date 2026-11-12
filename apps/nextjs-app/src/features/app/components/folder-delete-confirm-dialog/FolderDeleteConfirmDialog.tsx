import { BaseNodeResourceType } from '@teable/openapi';
import type { IDeleteBaseNodeProgress } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { cn, Progress } from '@teable/ui-lib/shadcn';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { LoginAppWarning } from '../LoginAppWarning';
import { OperationPreviewPanel, useOperationPreview } from '../operation-preview';
import type { IFolderDeleteListItem } from './folderDeletePresentation';
import { buildFolderDeletePresentation } from './folderDeletePresentation';

export interface FolderDeleteConfirmDialogProps {
  open: boolean;
  nodeId: string;
  folderName: string;
  isDeleting?: boolean;
  /** How far the delete is; still set after a delete that stopped part way. */
  progress?: IDeleteBaseNodeProgress;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

const nounKeys = {
  [BaseNodeResourceType.Table]: 'noun.table',
  [BaseNodeResourceType.App]: 'noun.app',
  [BaseNodeResourceType.Workflow]: 'noun.automation',
  [BaseNodeResourceType.Routine]: 'noun.routine',
  [BaseNodeResourceType.Dashboard]: 'noun.dashboard',
  [BaseNodeResourceType.Folder]: 'noun.folder',
} as const satisfies Record<BaseNodeResourceType, string>;

const Notice = ({ children, tone = 'warning' }: { children: ReactNode; tone?: string }) => (
  <div
    role={tone === 'danger' ? 'alert' : undefined}
    className={cn(
      'flex gap-2 rounded-md border px-3 py-2 text-[13px]',
      tone === 'danger'
        ? 'border-destructive/30 bg-destructive/5'
        : 'border-amber-200/70 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-200'
    )}
  >
    {tone === 'danger' ? (
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
    ) : (
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" />
    )}
    <div className="min-w-0 space-y-1">{children}</div>
  </div>
);

/** The list's word for an item, and whether it is one to look at. */
const badgeOf = (item: IFolderDeleteListItem): { key: string; strong: boolean } => {
  if (item.blocked) return { key: 'folderDelete.badge.blocked', strong: true };
  if (item.appOffline) return { key: 'folderDelete.badge.offline', strong: true };
  if (item.permanent) return { key: 'folderDelete.badge.permanent', strong: true };
  if (item.fieldCount > 0) {
    const key = item.fieldCountAtLeast
      ? 'folderDelete.badge.impactsAtLeast'
      : 'folderDelete.badge.impacts';
    return { key, strong: true };
  }
  if (item.resourceType === BaseNodeResourceType.Folder)
    return { key: 'noun.folder', strong: false };
  if (item.resourceType === BaseNodeResourceType.Table) {
    return { key: 'folderDelete.badge.none', strong: false };
  }
  return { key: 'folderDelete.badge.trash', strong: false };
};

const ItemBadge = ({ item }: { item: IFolderDeleteListItem }) => {
  const { t } = useTranslation('common');
  const { key, strong } = badgeOf(item);
  return (
    <span
      className={cn(
        'shrink-0 text-xs',
        strong ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
        item.blocked && 'text-destructive'
      )}
    >
      {t(key as 'folderDelete.badge.impacts', { count: item.fieldCount })}
    </span>
  );
};

const TableDetail = ({ tableId }: { tableId: string }) => {
  const baseId = useBaseId();
  const preview = useOperationPreview(
    {
      operation: 'table.delete',
      input: { baseId, tableId, mode: 'soft' },
      options: { detail: 'full' },
    },
    Boolean(baseId && tableId)
  );
  return (
    <OperationPreviewPanel
      preview={preview.data}
      error={preview.error}
      isLoading={preview.isPending || preview.isFetching}
      onRetry={() => void preview.refetch()}
    />
  );
};

const ItemDetail = ({ item }: { item: IFolderDeleteListItem }) => {
  const { t } = useTranslation('common');
  const name = item.name || t('folderDelete.hiddenItem');
  // A table's own delete preview opens with its name and where it goes.
  if (item.resourceType === BaseNodeResourceType.Table && item.resourceId) {
    return <TableDetail tableId={item.resourceId} />;
  }
  return (
    <div className="space-y-2">
      <div className="space-y-1 rounded-md bg-muted/50 p-3">
        <h3 className="break-words font-semibold">{name}</h3>
        <p>{t(item.permanent ? 'folderDelete.detail.permanent' : 'folderDelete.detail.trash')}</p>
      </div>
      {item.appOffline && (
        <Notice>
          <p>{t('folderDelete.appOffline.title')}</p>
          <ul className="list-disc ps-4">
            {item.appOffline.publicLink && <li>{t('folderDelete.appOffline.publicLink')}</li>}
            {item.appOffline.customDomain && (
              <li>
                {t('folderDelete.appOffline.customDomain', {
                  domain: item.appOffline.customDomain,
                })}
              </li>
            )}
            {item.appOffline.loginConfig && <li>{t('folderDelete.appOffline.loginConfig')}</li>}
          </ul>
          <p>{t('folderDelete.appOffline.afterRestore')}</p>
        </Notice>
      )}
    </div>
  );
};

/**
 * Deleting a non-empty folder. The left list holds everything inside, the items with an impact
 * first; the right side details the selected one, a table by its own delete preview.
 */
export const FolderDeleteConfirmDialog = (props: FolderDeleteConfirmDialogProps) => {
  const { open, nodeId, folderName, isDeleting, progress, onOpenChange, onConfirm } = props;
  const { t } = useTranslation('common');
  const baseId = useBaseId();
  const preview = useOperationPreview(
    { operation: 'folder.delete', input: { baseId, nodeId }, options: { detail: 'full' } },
    open && Boolean(baseId && nodeId)
  );
  const presentation = useMemo(
    () => (preview.data ? buildFolderDeletePresentation(preview.data) : undefined),
    [preview.data]
  );
  const [selectedKey, setSelectedKey] = useState<string>();
  // Deleted some, then stopped: what was deleted is in the trash on its own; the dialog shows
  // what is left, and confirming deletes that.
  const stopped = !isDeleting && progress !== undefined;
  const { refetch } = preview;
  useEffect(() => {
    if (stopped) void refetch();
  }, [stopped, refetch]);
  const selected =
    presentation?.items.find((item) => item.key === selectedKey) ?? presentation?.items[0];

  const content =
    preview.isPending || preview.isFetching || preview.error || !presentation ? (
      <OperationPreviewPanel
        preview={undefined}
        error={preview.error}
        isLoading={preview.isPending || preview.isFetching}
        onRetry={() => void preview.refetch()}
      />
    ) : (
      <div className="flex min-h-0 flex-1 flex-col gap-2 text-sm">
        {isDeleting && progress && (
          <div className="space-y-1.5 rounded-md bg-muted/50 p-3">
            <p>{t('folderDelete.progress', { done: progress.done, total: progress.total })}</p>
            <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />
          </div>
        )}
        {stopped && (
          <Notice tone="danger">
            <p>{t('folderDelete.stopped')}</p>
          </Notice>
        )}
        <div className="space-y-1 rounded-md bg-muted/50 p-3">
          <p>{t('folderDelete.summary')}</p>
          <p className="flex flex-wrap gap-x-3 text-muted-foreground">
            {Object.entries(presentation.counts).map(([type, count]) => (
              <span key={type}>
                {t(nounKeys[type as BaseNodeResourceType])}{' '}
                <span className="font-medium tabular-nums text-foreground">{count}</span>
              </span>
            ))}
          </p>
        </div>
        {presentation.blockedNames.length > 0 && (
          <Notice tone="danger">
            <p className="font-medium text-destructive">{t('operationPreview.blockedTitle')}</p>
            <p>{t('folderDelete.blocked')}</p>
            <p className="break-words">{presentation.blockedNames.join(', ')}</p>
          </Notice>
        )}
        {presentation.loginTables.map((entry) => (
          <LoginAppWarning
            key={entry.tableName}
            message={t('folderDelete.loginTable', { table: entry.tableName })}
            apps={entry.apps}
          />
        ))}
        {presentation.outsideReferences.length > 0 && (
          <Notice>
            <p>{t('folderDelete.outsideReferences')}</p>
            <ul className="list-disc ps-4">
              {presentation.outsideReferences.map((reference) => (
                <li key={reference.id} className="break-words">
                  {reference.name}
                  {reference.uncertain ? ` ${t('folderDelete.possibleReference')}` : ''}
                  {reference.tableNames.length > 0 && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {reference.tableNames.join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Notice>
        )}
        {presentation.shares.total > 0 && (
          <Notice>
            <p>{t('folderDelete.shares', { count: presentation.shares.total })}</p>
            <p className="break-words">{presentation.shares.names.join(', ')}</p>
          </Notice>
        )}
        {presentation.unreadAppNames.length > 0 && (
          <Notice>
            <p>{t('folderDelete.unreadApps')}</p>
            <p className="break-words">{presentation.unreadAppNames.join(', ')}</p>
          </Notice>
        )}
        {/* Side by side from sm up; on a phone the list sits above the detail. */}
        <div className="flex min-h-[240px] flex-1 flex-col gap-3 overflow-hidden sm:flex-row">
          <ul className="max-h-40 shrink-0 space-y-0.5 overflow-y-auto border-b pb-2 sm:max-h-none sm:w-56 sm:border-b-0 sm:border-e sm:pb-0 sm:pe-2">
            {presentation.items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-start hover:bg-accent',
                    selected?.key === item.key && 'bg-accent'
                  )}
                  onClick={() => setSelectedKey(item.key)}
                >
                  <span className="truncate">{item.name || t('folderDelete.hiddenItem')}</span>
                  <ItemBadge item={item} />
                </button>
              </li>
            ))}
          </ul>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {selected && <ItemDetail item={selected} />}
          </div>
        </div>
      </div>
    );

  // A delete under way runs to the end on the server, so the dialog stays until it is done.
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (next || !isDeleting) onOpenChange(next);
      }}
      closeable={!isDeleting}
      contentClassName="flex max-h-[640px] max-w-3xl flex-col"
      title={
        <span className="block pe-6 [overflow-wrap:anywhere]">
          {t('folderDelete.title', { name: folderName })}
        </span>
      }
      content={content}
      cancelText={isDeleting ? undefined : t('actions.cancel')}
      confirmText={stopped ? t('folderDelete.continue') : t('trash.addToTrash')}
      confirmLoading={isDeleting}
      confirmDisabled={isDeleting || !preview.canConfirm}
      onCancel={() => onOpenChange(false)}
      onConfirm={() => {
        if (preview.canConfirm && !isDeleting) onConfirm();
      }}
    />
  );
};
