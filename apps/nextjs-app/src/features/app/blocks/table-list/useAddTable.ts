import { useBase } from '@teable-group/sdk/hooks';
import { useRouter } from 'next/router';
import { useCallback } from 'react';

export function useAddTable() {
  const base = useBase();
  const router = useRouter();
  const { baseId } = router.query;

  return useCallback(async () => {
    const tableData = (await base.createTable()).data;
    const tableId = tableData.id;
    const viewId = tableData.defaultViewId;
    router.push(
      {
        pathname: '/base/[baseId]/[nodeId]/[viewId]',
        query: { baseId, nodeId: tableId, viewId },
      },
      undefined,
      {
        shallow: Boolean(router.query.viewId),
      }
    );
  }, [baseId, router, base]);
}
