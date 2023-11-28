import { ViewType } from '@teable-group/core';
import { useView } from '@teable-group/sdk/hooks';
import { FormToolBar } from './FormToolBar';
import { GridToolBar } from './GridToolBar';

export const ToolBar: React.FC = () => {
  const view = useView();
  const viewType = view?.type;

  if (viewType === ViewType.Form) {
    return <FormToolBar />;
  }

  return <GridToolBar />;
};
