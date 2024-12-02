import { ViewType } from '@teable/core';
import { useView } from '@teable/sdk';
import { CalendarView } from './calendar/CalendarView';
import { FormView } from './form/FormView';
import { GalleryView } from './gallery/GalleryView';
import { GridView } from './grid/GridView';
import { KanbanView } from './kanban/KanbanView';
import { PluginView } from './plugin/PluginView';
import type { IViewBaseProps } from './types';

export const View = (props: IViewBaseProps) => {
  const view = useView();
  const viewType = view?.type;

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
