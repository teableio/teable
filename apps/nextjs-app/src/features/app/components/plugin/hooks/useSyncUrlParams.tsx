import type { IChildBridgeMethods } from '@teable/sdk/plugin-bridge';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export const useSyncUrlParams = (bridge: IChildBridgeMethods | undefined) => {
  const router = useRouter();
  const { baseId, tableId, viewId, dashboardId, recordId, shareId } = router.query;
  useEffect(() => {
    bridge?.syncUrlParams({
      baseId: baseId as string,
      tableId: tableId as string,
      viewId: viewId as string,
      dashboardId: dashboardId as string,
      recordId: recordId as string,
      shareId: shareId as string,
    });
  }, [baseId, tableId, viewId, dashboardId, recordId, shareId, bridge]);
};
