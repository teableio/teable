import { useMutation } from '@tanstack/react-query';
import { Lock, Share2, Trash } from '@teable/icons';
import { duplicateView } from '@teable/openapi';
import { AnchorContext } from '@teable/sdk/context';
import {
  usePersonalView,
  useTableId,
  useTablePermission,
  useView,
  useViewId,
} from '@teable/sdk/hooks';
import type { IViewInstance } from '@teable/sdk/model';
import { Spin } from '@teable/ui-lib/base';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@teable/ui-lib/shadcn';
import { CopyPlus, Download, Pen, Unlock } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useContext, useMemo, useState } from 'react';
import { useNavigateToView } from '@/features/app/hooks/useResourceNavigation';
import { useDownload } from '../../../hooks/useDownLoad';
import { UnifiedShareDialog } from '../tool-bar/UnifiedShareDialog';
import { PinViewItem } from './PinViewItem';
import { useDeleteView } from './useDeleteView';

export type IViewMenuKind = 'context' | 'dropdown';

/**
 * A view's actions (rename, export, duplicate, lock, star, share, delete), drawn into either a
 * context menu (the view tab) or a dropdown menu (a row of the view list). They act on `view`,
 * which need not be the open one. The share dialog lives outside the menu, so the host renders
 * `dialogs` beside it.
 */
export const useViewActions = ({
  view,
  removable,
  onRename,
}: {
  view: IViewInstance;
  removable: boolean;
  onRename: () => void;
}) => {
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  // Mounted on first use: a list renders this for every view, and only one menu opens at a time.
  const [shareDialogMounted, setShareDialogMounted] = useState(false);
  const anchor = useContext(AnchorContext);
  const tableId = useTableId() as string;
  const navigateToView = useNavigateToView();
  const deleteView = useDeleteView(view.id);
  const permission = useTablePermission();
  const { t } = useTranslation(['table', 'common']);
  const { personalViewCommonQuery } = usePersonalView();
  const isOpenView = useViewId() === view.id;
  // The open view's data: its personal-view query applies only when exporting that view.
  const viewData = useView();

  const { mutateAsync: duplicateViewFn, isPending: isDuplicateViewLoading } = useMutation({
    mutationFn: () => duplicateView(tableId, view.id),
    onSuccess: (data) => {
      const { id } = data?.data || {};
      if (!id) {
        return;
      }
      navigateToView(tableId, id);
    },
  });
  const downloadUrl = useMemo(() => {
    const { ignoreViewQuery, filter, orderBy, groupBy, projection } = personalViewCommonQuery || {};

    if (!isOpenView || !ignoreViewQuery) {
      return `/api/export/${tableId}?viewId=${view.id}`;
    }

    const params = new URLSearchParams();
    params.set('viewId', viewData?.id ?? '');
    params.set('ignoreViewQuery', 'true');

    filter && params.set('filter', JSON.stringify(filter));
    orderBy && !viewData?.sort?.manualSort && params.set('orderBy', JSON.stringify(orderBy));
    groupBy && params.set('groupBy', JSON.stringify(groupBy));
    projection?.forEach((field) => params.append('projection[]', field));

    if (viewData?.columnMeta) {
      const columnMetaWithOrderOnly = Object.fromEntries(
        Object.entries(viewData.columnMeta).map(([fieldId, meta]) => [
          fieldId,
          { order: meta.order },
        ])
      );
      params.set('columnMeta', JSON.stringify(columnMetaWithOrderOnly));
    }

    return `/api/export/${tableId}?${params.toString()}`;
  }, [
    isOpenView,
    view.id,
    personalViewCommonQuery,
    tableId,
    viewData?.columnMeta,
    viewData?.id,
    viewData?.sort?.manualSort,
  ]);

  const { trigger } = useDownload({
    downloadUrl,
    key: 'view',
  });

  const renderItems = (kind: IViewMenuKind) => {
    // Both menus take the same item props; the dropdown's items have no gap of their own.
    const Item = (
      kind === 'context' ? ContextMenuItem : DropdownMenuItem
    ) as typeof ContextMenuItem;
    const Separator = kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator;
    const gap = kind === 'dropdown' ? 'gap-2' : undefined;
    return (
      <>
        {permission['view|update'] && (
          <Item className={gap} onClick={onRename}>
            <Pen className="size-4 shrink-0" />
            {t('view.action.rename')}
          </Item>
        )}
        {view.type === 'grid' && permission['table|export'] && (
          <Item className={gap} onClick={() => trigger?.()}>
            <Download className="size-4 shrink-0" />
            {t('import.menu.downAsCsv')}
          </Item>
        )}
        {permission['view|create'] && (
          <Item
            className={gap}
            onClick={async () => {
              await duplicateViewFn();
            }}
            disabled={isDuplicateViewLoading}
          >
            <CopyPlus className="size-4 shrink-0" />
            {t('view.action.duplicate')}
            {isDuplicateViewLoading && <Spin className="size-3 shrink-0" />}
          </Item>
        )}
        {permission['view|update'] && (
          <>
            <Separator />
            <Item
              className={gap}
              onClick={(e) => {
                // The view tab's context menu stays open to show the new state; a dropdown
                // closes, so the click reads as done and the lock shows on the view itself.
                if (kind === 'context') e.preventDefault();
                view.updateLocked(!view.isLocked);
              }}
            >
              {view.isLocked ? (
                <Unlock className="size-4 shrink-0" />
              ) : (
                <Lock className="size-4 shrink-0" />
              )}
              {view.isLocked ? t('view.action.unlock') : t('view.action.lock')}
            </Item>
          </>
        )}
        <PinViewItem viewId={view.id} Item={Item} className={gap} />
        {permission['view|update'] && (
          <>
            <Separator />
            <Item
              className={gap}
              onClick={() => {
                setShareDialogMounted(true);
                setShareDialogOpen(true);
              }}
            >
              <Share2 className="size-4 shrink-0" />
              {t('common:actions.share')}
            </Item>
          </>
        )}
        {permission['view|delete'] && (
          <>
            <Separator />
            <Item
              disabled={!removable}
              className="gap-2 text-red-500 focus:text-red-500"
              onClick={(e) => {
                e.preventDefault();
                deleteView();
              }}
            >
              <Trash className="size-4 shrink-0" />
              {t('view.action.delete')}
            </Item>
          </>
        )}
      </>
    );
  };

  // The share dialog reads the open view through the anchor; point it at this view instead.
  const dialogs = shareDialogMounted && (
    <AnchorContext.Provider value={{ ...anchor, viewId: view.id }}>
      <UnifiedShareDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        defaultTab="view"
        showTabs={false}
      />
    </AnchorContext.Provider>
  );

  return { renderItems, dialogs };
};
