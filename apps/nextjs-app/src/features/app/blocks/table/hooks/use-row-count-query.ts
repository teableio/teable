import { View } from '@teable-group/sdk/model';
import { useEffect, useState } from 'react';

export const useRowCountQuery = (tableId: string, viewId: string) => {
  const [rowCount, setRowCount] = useState<number>();

  useEffect(() => {
    View.getViewRowCount(tableId, viewId).then((res) => {
      setRowCount(res.data?.rowCount);
    });
  }, [tableId, viewId]);

  return rowCount;
};
