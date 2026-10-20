import { ViewType } from '@teable/core';
import { useTable, useViews } from '@teable/sdk/hooks';
import { useCallback } from 'react';
import { useNavigateToView } from '@/features/app/hooks/useResourceNavigation';

export function useAddView() {
  const table = useTable();
  const views = useViews();
  const navigateToView = useNavigateToView();
  const viewName = views?.[views.length - 1]?.name + ' ' + views?.length;

  return useCallback(
    async (type: ViewType = ViewType.Grid, name?: string) => {
      if (!table) {
        return;
      }

      const viewDoc = (
        await table.createView({
          name: name ?? viewName,
          type,
        })
      ).data;
      navigateToView(table.id, viewDoc.id);
    },
    [navigateToView, table, viewName]
  );
}
