import { useTable } from '@teable-group/sdk/hooks';
import { useRouter } from 'next/router';
import { useCallback } from 'react';

export function useDeleteView(viewId: string) {
  const table = useTable();
  const router = useRouter();

  return useCallback(async () => {
    if (!table) {
      return;
    }

    await table.deleteView({
      tableId: table.id,
      viewId,
    });
    const { baseId } = router.query;
    router.push({
      pathname: '/base/[baseId]/[tableId]',
      query: { baseId, tableId: table.id },
    });
  }, [router, table, viewId]);
}
