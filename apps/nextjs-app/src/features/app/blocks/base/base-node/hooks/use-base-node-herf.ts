import { useBaseId, useTableId } from '@teable/sdk/hooks';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';

// implement the lastVisitMap
export const useBaseNodeHref = () => {
  const baseId = useBaseId();
  const tableId = useTableId();
  const { dashboardId, workflowId, appId } = useParams();

  return useMemo(() => {
    return {
      baseId,
      tableId,
      dashboardId,
      workflowId,
      appId,
    };
  }, [baseId, tableId, dashboardId, workflowId, appId]);
};
