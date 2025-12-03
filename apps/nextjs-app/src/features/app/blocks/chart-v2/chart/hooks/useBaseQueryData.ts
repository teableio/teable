import { useQuery } from '@tanstack/react-query';
import {
  getDashboardInstallPluginQueryV2,
  getPluginPanelInstallPluginQueryV2,
  PluginPosition,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useMemo } from 'react';
import { useEnv } from '../../../chart/hooks/useEnv';

export const useBaseQueryData = () => {
  const { baseId, positionId, positionType, pluginInstallId, tableId } = useEnv();
  const {
    data: dashboardQueryData = {
      result: [],
      columns: [],
    },
  } = useQuery({
    queryKey: ReactQueryKeys.dashboardPluginQueryV2(baseId, positionId, pluginInstallId),
    queryFn: () =>
      getDashboardInstallPluginQueryV2(pluginInstallId, positionId, baseId).then((res) => res.data),
    enabled: Boolean(
      positionType === PluginPosition.Dashboard && baseId && positionId && pluginInstallId
    ),
  });

  const {
    data: pluginPanelQueryData = {
      result: [],
      columns: [],
    },
  } = useQuery({
    queryKey: ReactQueryKeys.pluginPanelPluginQueryV2(tableId!, positionId, pluginInstallId),
    queryFn: () =>
      getPluginPanelInstallPluginQueryV2(pluginInstallId, positionId, tableId!).then(
        (res) => res.data
      ),
    enabled: Boolean(
      positionType === PluginPosition.Panel && tableId && positionId && pluginInstallId
    ),
  });

  return useMemo(() => {
    if (positionType === PluginPosition.Dashboard) {
      return dashboardQueryData;
    }
    return pluginPanelQueryData;
  }, [positionType, pluginPanelQueryData, dashboardQueryData]);
};
