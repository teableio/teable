import { useQuery } from '@tanstack/react-query';
import type { CellFormat } from '@teable/core';
import {
  getDashboardInstallPluginQuery,
  getPluginPanelInstallPluginQuery,
  PluginPosition,
} from '@teable/openapi';
import { useMemo } from 'react';
import { formatRes } from '../query';
import { useEnv } from './useEnv';

export const useBaseQueryData = (cellFormat?: CellFormat) => {
  const { baseId, positionId, positionType, tableId, pluginInstallId } = useEnv();
  const { data: dashboardQueryData } = useQuery({
    queryKey: ['dashboard-plugin-query', baseId, positionId, pluginInstallId],
    queryFn: () =>
      getDashboardInstallPluginQuery(pluginInstallId, positionId, {
        baseId,
        cellFormat,
      }).then((res) => res.data),
    enabled: Boolean(
      positionType === PluginPosition.Dashboard && baseId && positionId && pluginInstallId
    ),
  });

  const { data: pluginPanelQueryData } = useQuery({
    queryKey: ['plugin-panel-plugin-query', tableId, positionId, pluginInstallId],
    queryFn: () =>
      getPluginPanelInstallPluginQuery(pluginInstallId, positionId, {
        tableId: tableId!,
        cellFormat,
      }).then((res) => res.data),
    enabled: Boolean(
      positionType === PluginPosition.Panel && tableId && positionId && pluginInstallId
    ),
  });

  return useMemo(() => {
    if (positionType === PluginPosition.Dashboard) {
      return formatRes(dashboardQueryData);
    }
    return formatRes(pluginPanelQueryData);
  }, [positionType, pluginPanelQueryData, dashboardQueryData]);
};
