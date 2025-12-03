import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import { baseQuerySchemaVoV2, type IBaseQueryVoV2 } from './dashboard-query-v2';

export const GET_PLUGIN_PANEL_INSTALL_PLUGIN_QUERY_V2 =
  '/plugin/chart/{pluginInstallId}/plugin-panel/{positionId}/query/v2';

export const GetPluginPanelInstallPluginQueryV2Route: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PLUGIN_PANEL_INSTALL_PLUGIN_QUERY_V2,
  description: 'Get a plugin panel install plugin query by id',
  request: {
    params: z.object({
      pluginInstallId: z.string(),
      positionId: z.string(),
    }),
    query: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about the plugin panel install plugin query.',
      content: {
        'application/json': {
          schema: baseQuerySchemaVoV2,
        },
      },
    },
  },
  tags: ['plugin', 'chart', 'plugin-panel'],
});

export const getPluginPanelInstallPluginQueryV2 = async (
  pluginInstallId: string,
  positionId: string,
  tableId: string
) => {
  return axios.get<IBaseQueryVoV2>(
    urlBuilder(GET_PLUGIN_PANEL_INSTALL_PLUGIN_QUERY_V2, { pluginInstallId, positionId }),
    {
      params: {
        tableId,
      },
    }
  );
};
