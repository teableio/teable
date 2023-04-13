import { useSpace, useTables } from '@teable-group/sdk/hooks';
import { useRouter } from 'next/router';
import { useCallback } from 'react';
import { trpc } from 'utils/trpc';
import { DEFAULT_FIELDS, DEFAULT_RECORDS, DEFAULT_VIEW } from './constant';

export function useAddTable() {
  const space = useSpace();
  const tables = useTables();
  const tableName = tables[tables.length - 1]?.name + ' ' + tables.length;
  const router = useRouter();

  const createTable = trpc.table.createTable.useMutation();

  return useCallback(async () => {
    const tableData = await createTable.mutateAsync({
      name: tableName,
      views: [DEFAULT_VIEW],
      fields: DEFAULT_FIELDS,
      rows: DEFAULT_RECORDS,
    });
    const tableId = tableData.id;
    router.push({
      pathname: '/space/[tableId]',
      query: { tableId: tableId },
    });
  }, [createTable, router, tableName]);
}
