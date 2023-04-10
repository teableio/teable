import { useSpace, useTables } from '@teable-group/sdk/hooks';
import { useRouter } from 'next/router';
import { useCallback } from 'react';

export function useAddTable() {
  const space = useSpace();
  const tables = useTables();
  const tableName = tables[tables.length - 1].name + ' ' + tables.length;
  const router = useRouter();

  return useCallback(async () => {
    const tableData = await space.createTable(tableName);
    const tableId = tableData.id;
    router.push({
      pathname: '/space/[tableId]',
      query: { tableId: tableId },
    });
  }, [router, space, tableName]);
}
