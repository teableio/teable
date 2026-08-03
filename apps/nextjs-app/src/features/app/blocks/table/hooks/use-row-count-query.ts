import { Table } from '@teable/sdk/model';
import { useEffect, useState } from 'react';

export const useRowCountQuery = (tableId: string, viewId: string) => {
  const [rowCount, setRowCount] = useState<number>();

  useEffect(() => {
    Table.getRowCount(tableId, { viewId }).then((res) => {
      setRowCount(res.data?.rowCount);
    });
  }, [tableId, viewId]);

  return rowCount;
};
