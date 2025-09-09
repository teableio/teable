import { useQuery } from '@tanstack/react-query';
import {
  getDashboardInstallPluginQuery,
  getPluginPanelPluginQuery,
  PluginPosition,
} from '@teable/openapi';
import { formatRes } from '../query';
import { useEnv } from './useEnv';

export const useBaseQueryData = () => {
  const { baseId, positionId, positionType, tableId, pluginInstallId } = useEnv();
  const { data: dashboardQueryData } = useQuery({
    queryKey: ['dashboard-plugin-query', baseId, positionId, pluginInstallId],
    queryFn: () =>
      getDashboardInstallPluginQuery(baseId, positionId, pluginInstallId).then((res) => res.data),
    enabled: Boolean(
      positionType === PluginPosition.Dashboard && baseId && positionId && pluginInstallId
    ),
  });

  const { data: pluginPanelQueryData } = useQuery({
    queryKey: ['plugin-panel-plugin-query', tableId, positionId, pluginInstallId],
    queryFn: () =>
      getPluginPanelPluginQuery(tableId!, positionId, pluginInstallId).then((res) => res.data),
    enabled: Boolean(
      positionType === PluginPosition.Panel && tableId && positionId && pluginInstallId
    ),
  });

  if (positionType === PluginPosition.Dashboard) {
    return formatRes(dashboardQueryData);
  }

  return formatRes(pluginPanelQueryData);
};
