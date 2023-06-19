import { useTable, useViews } from '@teable-group/sdk/hooks';
import { useRouter } from 'next/router';
import { useCallback } from 'react';

export function useDeleteView(viewId: string) {
  const table = useTable();
  const views = useViews();
  const router = useRouter();
  const firstView = views[0];

  return useCallback(async () => {
    if (!table) {
      return;
    }

    await table.deleteView({
      tableId: table.id,
      viewId,
    });
    router.push({
      pathname: '/space/[tableId]/[viewId]',
      query: { tableId: table.id, viewId: firstView.id },
    });
  }, [router, table, viewId, firstView.id]);
}
