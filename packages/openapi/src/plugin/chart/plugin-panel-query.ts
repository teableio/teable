import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { CellFormat } from '@teable/core';
import { axios } from '../../axios';
import { baseQuerySchemaVo, type IBaseQueryVo } from '../../base';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const GET_PLUGIN_PANEL_INSTALL_PLUGIN_QUERY =
  '/plugin/chart/{pluginInstallId}/plugin-panel/{positionId}/query';

export const getPluginPanelInstallPluginQueryRoSchema = z.object({
  tableId: z.string(),
  cellFormat: z
    .nativeEnum(CellFormat, {
      errorMap: () => ({ message: 'Error cellFormat, You should set it to "json" or "text"' }),
    })
    .optional(),
});

export type IGetPluginPanelInstallPluginQueryRo = z.infer<
  typeof getPluginPanelInstallPluginQueryRoSchema
>;

export const GetPluginPanelInstallPluginQueryRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PLUGIN_PANEL_INSTALL_PLUGIN_QUERY,
  description: 'Get a plugin panel install plugin query by id',
  request: {
    params: z.object({
      pluginInstallId: z.string(),
      positionId: z.string(),
    }),
    query: getPluginPanelInstallPluginQueryRoSchema,
  },
  responses: {
    200: {
      description: 'Returns data about the plugin panel install plugin query.',
      content: {
        'application/json': {
          schema: baseQuerySchemaVo,
        },
      },
    },
  },
  tags: ['plugin', 'chart', 'plugin-panel'],
});

export const getPluginPanelInstallPluginQuery = async (
  pluginInstallId: string,
  positionId: string,
  query: IGetPluginPanelInstallPluginQueryRo
) => {
  return axios.get<IBaseQueryVo>(
    urlBuilder(GET_PLUGIN_PANEL_INSTALL_PLUGIN_QUERY, { pluginInstallId, positionId }),
    {
      params: query,
    }
  );
};
