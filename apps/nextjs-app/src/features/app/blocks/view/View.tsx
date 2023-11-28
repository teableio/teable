import { ViewType } from '@teable-group/core';
import { useView } from '@teable-group/sdk';
import { FormView } from './form/FormView';
import { GridView } from './grid/GridView';
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
      default:
        return null;
    }
  };

  return getViewComponent();
};
