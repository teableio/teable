import { useSpace } from '@teable-group/sdk/hooks';
import { useRouter } from 'next/router';
import { useCallback } from 'react';

export function useAddTable() {
  const space = useSpace();
  const router = useRouter();

  return useCallback(async () => {
    const tableData = await space.createTable();
    const tableId = tableData.id;
    router.push({
      pathname: '/space/[tableId]',
      query: { tableId: tableId },
    });
  }, [router, space]);
}
