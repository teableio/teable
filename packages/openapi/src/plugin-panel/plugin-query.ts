import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { CellFormat } from '@teable/core';
import { axios } from '../axios';
import { baseQuerySchemaVo, type IBaseQueryVo } from '../base';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { pluginPanelPluginGetRoSchema } from './plugin-get';

export const PLUGIN_PANEL_PLUGIN_QUERY =
  '/table/{tableId}/plugin-panel/{pluginPanelId}/plugin/{pluginInstallId}/query';

export const pluginPanelPluginQueryRoute: RouteConfig = registerRoute({
  method: 'get',
  path: PLUGIN_PANEL_PLUGIN_QUERY,
  description: 'Get a plugin query in plugin panel',
  request: {
    params: pluginPanelPluginGetRoSchema,
    query: z.object({
      cellFormat: z
        .nativeEnum(CellFormat, {
          errorMap: () => ({ message: 'Error cellFormat, You should set it to "json" or "text"' }),
        })
        .default(CellFormat.Text),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about the plugin query.',
      content: {
        'application/json': {
          schema: baseQuerySchemaVo,
        },
      },
    },
  },
  tags: ['plugin-panel'],
});

export const getPluginPanelPluginQuery = (
  tableId: string,
  pluginPanelId: string,
  pluginInstallId: string,
  cellFormat?: CellFormat
) => {
  return axios.get<IBaseQueryVo>(
    urlBuilder(PLUGIN_PANEL_PLUGIN_QUERY, { tableId, pluginPanelId, pluginInstallId }),
    {
      params: {
        cellFormat,
      },
    }
  );
};
