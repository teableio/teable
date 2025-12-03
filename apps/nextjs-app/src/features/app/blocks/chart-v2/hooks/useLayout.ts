import { useQuery } from '@tanstack/react-query';
import { getDashboard, getPluginPanel, PluginPosition } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useMemo } from 'react';
import { useEnv } from './useEnv';

export const useLayout = () => {
  const { baseId, positionId, pluginInstallId, positionType, tableId } = useEnv();

  const { data: dashboardData, isLoading: isDashboardLoading } = useQuery({
    queryKey: ReactQueryKeys.getDashboard(positionId),
    queryFn: () => getDashboard(baseId, positionId).then((res) => res.data),
    enabled: Boolean(
      positionType === PluginPosition.Dashboard && baseId && positionId && pluginInstallId
    ),
  });

  const { data: pluginPanelData, isLoading: isPluginPanelLoading } = useQuery({
    queryKey: ReactQueryKeys.getPluginPanel(tableId!, positionId),
    queryFn: () => getPluginPanel(tableId!, positionId).then((res) => res.data),
    enabled: Boolean(
      positionType === PluginPosition.Panel && tableId && positionId && pluginInstallId
    ),
  });

  const layout = useMemo(() => {
    if (positionType === PluginPosition.Dashboard) {
      return dashboardData?.layout?.find((item) => item.pluginInstallId === pluginInstallId);
    }
    return pluginPanelData?.layout?.find((item) => item.pluginInstallId === pluginInstallId);
  }, [dashboardData?.layout, pluginInstallId, pluginPanelData?.layout, positionType]);

  return {
    layout,
    isLoading:
      positionType === PluginPosition.Dashboard ? isDashboardLoading : isPluginPanelLoading,
  };
};
