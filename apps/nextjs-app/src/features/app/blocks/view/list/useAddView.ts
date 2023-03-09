import { ViewType } from '@teable-group/core';
import { useTable, useViews } from '@teable-group/sdk/hooks';
import { useCallback } from 'react';

export function useAddView() {
  const table = useTable();
  const views = useViews();
  const viewName = views[views.length - 1].name + ' ' + views.length;

  return useCallback(() => table?.createView(viewName, ViewType.Grid), [table, viewName]);
}
