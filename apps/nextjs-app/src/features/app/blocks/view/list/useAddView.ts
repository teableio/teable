import { ViewType } from '@teable-group/core';
import { useTable, useViews } from '@teable-group/sdk/hooks';
import { useRouter } from 'next/router';
import { useCallback } from 'react';

export function useAddView() {
  const table = useTable();
  const views = useViews();
  const router = useRouter();
  const viewName = views[views.length - 1]?.name + ' ' + views.length;

  return useCallback(async () => {
    if (!table) {
      return;
    }

    const viewDoc = await table.createView({
      name: viewName,
      type: ViewType.Grid,
      tableId: table.id,
    });
    const viewId = viewDoc.id;
    router.push(
      {
        pathname: '/space/[nodeId]/[viewId]',
        query: { nodeId: table.id, viewId },
      },
      undefined,
      { shallow: Boolean(router.query.viewId) }
    );
  }, [router, table, viewName]);
}
