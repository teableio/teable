import { IdPrefix, ViewType } from '@teable/core';
import {
  useConnection,
  useIsReadOnlyPreview,
  usePersonalView,
  useTableId,
  useView,
  useViews,
} from '@teable/sdk';
import { useTranslation } from 'next-i18next';
import { useEffect } from 'react';
import type { Query } from 'sharedb';
import { useShareEffectiveEdit } from '@/features/app/context/ShareContext';
import { tableConfig } from '@/features/i18n/table.config';
import { CalendarView } from './calendar/CalendarView';
import { FormView } from './form/FormView';
import { GalleryView } from './gallery/GalleryView';
import { GridView } from './grid/GridView';
import { KanbanView } from './kanban/KanbanView';
import { PluginView } from './plugin/PluginView';
import type { IViewBaseProps } from './types';
import { ViewSkeleton } from './ViewSkeleton';

export const View = (props: IViewBaseProps) => {
  const view = useView();
  const views = useViews();
  const viewType = view?.type;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { connection } = useConnection();
  const tableId = useTableId();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const isShareEditor = useShareEffectiveEdit();
  const { openPersonalView, isPersonalView } = usePersonalView();

  // Auto-open personal view for read-only contexts:
  // template, can-view share, or anonymous on can-edit share (no real edit permissions).
  useEffect(() => {
    if (isReadOnlyPreview && !isShareEditor && !isPersonalView) {
      openPersonalView?.();
    }
  }, [isReadOnlyPreview, isShareEditor, openPersonalView, isPersonalView]);

  if (tableId && connection?.queries) {
    const query = Object.values(connection?.queries).find(
      (query: Query) => query.collection === `${IdPrefix.View}_${tableId}`
    );

    if (query?.ready && !views.length) {
      return (
        <>
          <div className="flex h-full flex-col items-center justify-center gap-y-4 text-center">
            <h3 data-testid="not-found-title" className="text-xl font-semibold text-foreground">
              {t('table:view.noView')}
            </h3>
            <p className="max-w-md text-sm text-muted-foreground">
              {t('common:admin.tips.pleaseContactAdmin')}
            </p>
          </div>
        </>
      );
    }
  }

  const getViewComponent = () => {
    switch (viewType) {
      case ViewType.Grid:
        return <GridView {...props} />;
      case ViewType.Form:
        return <FormView />;
      case ViewType.Kanban:
        return <KanbanView />;
      case ViewType.Gallery:
        return <GalleryView />;
      case ViewType.Calendar:
        return <CalendarView />;
      case ViewType.Plugin:
        return <PluginView />;
      default:
        // view not loaded yet (e.g. right after a table switch) — keep a
        // skeleton instead of a blank area; a loaded view of an unrecognized
        // type still renders nothing (a skeleton would read as a hang)
        return view ? null : <ViewSkeleton />;
    }
  };

  return getViewComponent();
};
