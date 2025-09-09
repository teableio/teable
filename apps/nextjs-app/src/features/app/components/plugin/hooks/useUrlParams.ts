import type { IUrlParams } from '@teable/sdk/plugin-bridge';
import { useRouter } from 'next/router';
import { useMemo } from 'react';

export const useUrlParams = () => {
  const router = useRouter();
  const { baseId, tableId, viewId, dashboardId, recordId, shareId } = router.query;
  return useMemo(() => {
    const urlParams: IUrlParams = {
      baseId: baseId as string,
      tableId: tableId as string,
      viewId: viewId as string,
      dashboardId: dashboardId as string,
      recordId: recordId as string,
      shareId: shareId as string,
    };
    return urlParams;
  }, [baseId, tableId, viewId, dashboardId, recordId, shareId]);
};
