import { ViewType } from '@teable/core';
import { useContext } from 'react';
import { FormView } from './component/FormView';
import { GridView } from './component/grid/GridView';
import { ShareViewPageContext } from './ShareViewPageContext';

export const ShareView = () => {
  const { view } = useContext(ShareViewPageContext);
  const viewType = view?.type;

  const getViewComponent = () => {
    // eslint-disable-next-line sonarjs/no-small-switch
    switch (viewType) {
      case ViewType.Form:
        return <FormView />;
      case ViewType.Grid:
        return <GridView />;
      default:
        return null;
    }
  };

  return <div className="h-screen w-full">{getViewComponent()}</div>;
};
