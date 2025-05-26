import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DUPLICATE_PANEL_INSTALLED_PLUGIN =
  '/table/{tableId}/plugin-panel/{pluginPanelId}/plugin/{installedId}/duplicate';

export const duplicatePluginPanelInstalledPluginRoSchema = z.object({
  name: z.string().optional(),
});

export type IDuplicatePluginPanelInstalledPluginRo = z.infer<
  typeof duplicatePluginPanelInstalledPluginRoSchema
>;

export const duplicatePluginPanelInstalledPluginRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DUPLICATE_PANEL_INSTALLED_PLUGIN,
  description: 'Duplicate a dashboard installed plugin',
  summary: 'Duplicate a dashboard installed plugin',
  request: {
    params: z.object({
      baseId: z.string(),
      id: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the duplicated dashboard info.',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            name: z.string(),
          }),
        },
      },
    },
  },
  tags: ['plugin-panel'],
});

export const duplicatePluginPanelInstalledPlugin = async (
  tableId: string,
  pluginPanelId: string,
  installedId: string,
  duplicatePluginPanelRo: IDuplicatePluginPanelInstalledPluginRo
) => {
  return axios.post<{ id: string; name: string }>(
    urlBuilder(DUPLICATE_PANEL_INSTALLED_PLUGIN, { tableId, pluginPanelId, installedId }),
    duplicatePluginPanelRo
  );
};
