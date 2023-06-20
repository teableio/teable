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
    router.push({
      pathname: '/space/[tableId]',
      query: { tableId: table.id },
    });
  }, [router, table, viewId]);
}
