import { dehydrate } from '@tanstack/react-query';
import type {
  IGetBaseVo,
  IGetDashboardInstallPluginVo,
  IPluginPanelPluginGetVo,
  ITableListVo,
  IUserMeVo,
} from '@teable/openapi';
import {
  createAxios,
  GET_BASE,
  GET_DASHBOARD_INSTALL_PLUGIN,
  GET_TABLE_LIST,
  PLUGIN_PANEL_PLUGIN_GET,
  PluginPosition,
  urlBuilder,
  USER_ME,
} from '@teable/openapi';
import { getQueryClient } from '../../../components/get-query-client';
import QueryClientProvider from '../../../components/QueryClientProvider';
import type { IPageParams } from '../../../types';
import { Pages } from './Pages';

export const ssrAxios = createAxios();
ssrAxios.defaults.baseURL =
  process.env.PLUGIN_TEABLE_BACKEND_BASE_URL || 'http://127.0.0.1:3000/api';

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

  await Promise.all([
    queryClient.fetchQuery({
      queryKey: ['base', baseId],
      queryFn: ({ queryKey }) =>
        queryKey[1]
          ? ssrAxios
              .get<IGetBaseVo>(urlBuilder(GET_BASE, { baseId: queryKey[1] }), {
                headers: {
                  cookie,
                },
              })
              .then(({ data }) => data)
          : undefined,
    }),
    queryClient.fetchQuery({
      queryKey: ['user-me'],
      queryFn: () =>
        ssrAxios
          .get<IUserMeVo>(urlBuilder(USER_ME), {
            headers: {
              cookie,
            },
          })
          .then(({ data }) => data),
    }),
  ]);

  const tableServerData = baseId
    ? await ssrAxios
        .get<ITableListVo>(urlBuilder(GET_TABLE_LIST, { baseId }), {
          headers: {
            cookie,
          },
        })
        .then(({ data }) => data)
    : undefined;

  return (
    <QueryClientProvider dehydratedState={dehydrate(queryClient)}>
      <Pages {...searchParams} tableServerData={tableServerData} />
    </QueryClientProvider>
  );
};
