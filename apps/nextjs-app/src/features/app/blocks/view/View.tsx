import { ViewType } from '@teable/core';
import { useView, useViews } from '@teable/sdk';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { CalendarView } from './calendar/CalendarView';
import { FormView } from './form/FormView';
import { GalleryView } from './gallery/GalleryView';
import { GridView } from './grid/GridView';
import { KanbanView } from './kanban/KanbanView';
import { PluginView } from './plugin/PluginView';
import type { IViewBaseProps } from './types';

export const View = (props: IViewBaseProps) => {
  const view = useView();
  const views = useViews();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const viewType = view?.type;

  if (!views.length) {
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
        return null;
    }
  };

  return getViewComponent();
};
