import { ViewType } from '@teable/core';
import { ShareViewContext } from '@teable/sdk/context';
import { useContext } from 'react';
import { FormView } from './component/form/FormView';
import { GridView } from './component/grid/GridView';
import { KanbanView } from './component/kanban/KanbanView';
import { PluginView } from './component/plugin/SharePluginView';

export const ShareView = () => {
  const { view, shareId, extra } = useContext(ShareViewContext);
  const viewType = view?.type;
  const getViewComponent = () => {
    // eslint-disable-next-line sonarjs/no-small-switch
    switch (viewType) {
      case ViewType.Form:
        return <FormView />;
      case ViewType.Grid:
        return <GridView />;
      case ViewType.Kanban:
        return <KanbanView />;
      case ViewType.Plugin:
        return <PluginView shareId={shareId} plugin={extra?.plugin} />;
      default:
        return null;
    }
  };

  return <div className="h-screen w-full">{getViewComponent()}</div>;
};
