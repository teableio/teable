import { useQuery } from '@tanstack/react-query';
import { getDashboardInstallPlugin, getPluginPanelPlugin, PluginPosition } from '@teable/openapi';
import { useEnv } from './useEnv';

export const usePluginInstall = () => {
  const { baseId, positionId, positionType, tableId, pluginInstallId } = useEnv();
  const { data: dashboardPluginInstall, isLoading: isDashboardPluginInstallLoading } = useQuery({
    queryKey: ['plugin-install', baseId, positionId, pluginInstallId],
    queryFn: () =>
      getDashboardInstallPlugin(baseId, positionId, pluginInstallId).then((res) => res.data),
    enabled: Boolean(
      positionType === PluginPosition.Dashboard && baseId && positionId && pluginInstallId
    ),
  });

  const { data: pluginPanelPluginInstall, isLoading: isPluginPanelPluginLoading } = useQuery({
    queryKey: ['plugin-panel-plugin', tableId, positionId, pluginInstallId],
    queryFn: () =>
      getPluginPanelPlugin(tableId!, positionId, pluginInstallId).then((res) => res.data),
    enabled: Boolean(
      positionType === PluginPosition.Panel && tableId && positionId && pluginInstallId
    ),
  });

  if (positionType === PluginPosition.Dashboard) {
    return {
      pluginInstall: dashboardPluginInstall,
      isLoading: isDashboardPluginInstallLoading,
    };
  }

  return {
    pluginInstall: pluginPanelPluginInstall,
    isLoading: isPluginPanelPluginLoading,
  };
};
