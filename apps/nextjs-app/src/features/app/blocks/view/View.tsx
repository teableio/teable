import { useQuery } from '@tanstack/react-query';
import { ViewType } from '@teable/core';
import { getViewList } from '@teable/openapi';
import { useView, useBaseId, useTableId, ReactQueryKeys } from '@teable/sdk';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect } from 'react';
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
  const router = useRouter();
  const baseId = useBaseId();
  const tableId = useTableId();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const viewType = view?.type;

  const { data: views = [] } = useQuery({
    queryKey: ReactQueryKeys.viewList(tableId!),
    queryFn: () => getViewList(tableId!).then((res) => res.data),
    enabled: !!tableId,
  });

  useEffect(() => {
    const defaultViewId = views?.[0]?.id;
    if (!view && views.length > 0 && defaultViewId) {
      console.warn('autoJump to default view', defaultViewId);
      router.push(`/base/${baseId}/${tableId}/${defaultViewId}`);
    }
  }, [router, views, view, baseId, tableId]);

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
