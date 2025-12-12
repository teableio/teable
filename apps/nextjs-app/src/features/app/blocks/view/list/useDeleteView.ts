import { useTable } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useCallback } from 'react';

export function useDeleteView(viewId: string) {
  const table = useTable();
  const router = useRouter();

  return useCallback(async () => {
    if (!table) {
      return;
    }

    await table.deleteView(viewId);
    const { baseId } = router.query;
    router.push(`/base/${baseId}/table/${table.id}`);
  }, [router, table, viewId]);
}
