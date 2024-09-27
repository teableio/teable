import { ViewType } from '@teable/core';
import { useView } from '@teable/sdk';
import { FormView } from './form/FormView';
import { GalleryView } from './gallery/GalleryView';
import { GridView } from './grid/GridView';
import { KanbanView } from './kanban/KanbanView';
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
      default:
        return null;
    }
  };

  return getViewComponent();
};
