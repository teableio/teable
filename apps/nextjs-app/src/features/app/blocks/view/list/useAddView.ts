import { ViewType } from '@teable/core';
import { useTable, useViews } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useCallback } from 'react';

export function useAddView() {
  const table = useTable();
  const views = useViews();
  const router = useRouter();
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
      const viewId = viewDoc.id;
      const { baseId } = router.query;
      router.push(
        {
          pathname: '/base/[baseId]/[tableId]/[viewId]',
          query: { baseId, tableId: table.id, viewId },
        },
        undefined,
        { shallow: Boolean(router.query.viewId) }
      );
    },
    [router, table, viewName]
  );
}
