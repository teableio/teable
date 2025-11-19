import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IChartStorage, IPluginInstallStorage } from '@teable/openapi';
import {
  getDashboardInstallPlugin,
  getPluginPanelPlugin,
  PluginPosition,
  renamePlugin,
  updateDashboardPluginStorage,
  updatePluginPanelStorage,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useEnv } from './useEnv';

export const usePluginInstall = () => {
  const queryClient = useQueryClient();
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

  const { mutate: renamePluginMutate } = useMutation({
    mutationFn: (name: string) => renamePlugin(baseId, positionId, pluginInstallId, name),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getDashboard(positionId));
    },
  });

  const { mutate: updateDashboardPluginStorageMutate } = useMutation({
    mutationFn: (storage: IChartStorage) =>
      updateDashboardPluginStorage(
        baseId,
        positionId,
        pluginInstallId,
        storage as unknown as IPluginInstallStorage
      ),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getDashboard(positionId));
      queryClient.invalidateQueries(['plugin-install', baseId, positionId, pluginInstallId]);
      queryClient.invalidateQueries([
        'dashboard-plugin-query-v2',
        baseId,
        positionId,
        pluginInstallId,
      ]);
    },
  });

  const { mutate: updatePluginPanelPluginStorageMutate } = useMutation({
    mutationFn: (storage: IChartStorage) =>
      updatePluginPanelStorage(tableId!, positionId, pluginInstallId, {
        storage,
      } as unknown as IPluginInstallStorage),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getPluginPanel(tableId!, positionId));
      queryClient.invalidateQueries(['plugin-panel-plugin', tableId, positionId, pluginInstallId]);
      queryClient.invalidateQueries([
        'plugin-panel-plugin-query-v2',
        tableId,
        positionId,
        pluginInstallId,
      ]);
    },
  });

  if (positionType === PluginPosition.Dashboard) {
    return {
      pluginInstall: dashboardPluginInstall,
      isLoading: isDashboardPluginInstallLoading,
      renamePlugin: renamePluginMutate,
      updatePluginStorage: updateDashboardPluginStorageMutate,
    };
  }

  return {
    pluginInstall: pluginPanelPluginInstall,
    isLoading: isPluginPanelPluginLoading,
    renamePlugin: renamePluginMutate,
    updatePluginStorage: updatePluginPanelPluginStorageMutate,
  };
};
