import { dehydrate } from '@tanstack/react-query';
import type { IGetDashboardInstallPluginVo, IPluginPanelPluginGetVo } from '@teable/openapi';
import {
  createAxios,
  GET_DASHBOARD_INSTALL_PLUGIN,
  PLUGIN_PANEL_PLUGIN_GET,
  PluginPosition,
  urlBuilder,
} from '@teable/openapi';
import { getQueryClient } from '../../../components/get-query-client';
import QueryClientProvider from '../../../components/QueryClientProvider';
import type { IPageParams } from '../../../types';
import { Pages } from './Pages';

export const ssrAxios = createAxios();
ssrAxios.defaults.baseURL = `http://localhost:${process.env.PORT}/api`;

export const Hydrated = async ({
  searchParams,
  cookie,
}: {
  searchParams: IPageParams;
  cookie: string;
}) => {
  const { baseId, positionId, pluginInstallId, positionType, tableId } = searchParams;
  const queryClient = getQueryClient();

  if (positionType === PluginPosition.Dashboard && baseId && positionId && pluginInstallId) {
    await queryClient.fetchQuery({
      queryKey: ['plugin-install', baseId, positionId, pluginInstallId],
      queryFn: () =>
        ssrAxios
          .get<IGetDashboardInstallPluginVo>(
            urlBuilder(GET_DASHBOARD_INSTALL_PLUGIN, {
              baseId,
              dashboardId: positionId,
              installPluginId: pluginInstallId,
            }),
            {
              headers: {
                cookie,
              },
            }
          )
          .then((res) => res.data),
    });
  }

  if (positionType === PluginPosition.Panel && tableId && positionId && pluginInstallId) {
    await queryClient.fetchQuery({
      queryKey: ['plugin-panel-plugin', baseId, positionId, pluginInstallId],
      queryFn: () =>
        ssrAxios
          .get<IPluginPanelPluginGetVo>(
            urlBuilder(PLUGIN_PANEL_PLUGIN_GET, {
              tableId,
              pluginPanelId: positionId,
              pluginInstallId,
            }),
            {
              headers: {
                cookie,
              },
            }
          )
          .then((res) => res.data),
    });
  }

  return (
    <QueryClientProvider dehydratedState={dehydrate(queryClient)}>
      <Pages {...searchParams} />
    </QueryClientProvider>
  );
};
