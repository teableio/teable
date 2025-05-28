import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DUPLICATE_DASHBOARD_INSTALLED_PLUGIN =
  '/base/{baseId}/dashboard/{id}/plugin/{installedId}/duplicate';

export const duplicateDashboardInstalledPluginRoSchema = z.object({
  name: z.string().optional(),
});

export type IDuplicateDashboardInstalledPluginRo = z.infer<
  typeof duplicateDashboardInstalledPluginRoSchema
>;

export const duplicateDashboardInstalledPluginRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DUPLICATE_DASHBOARD_INSTALLED_PLUGIN,
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
  tags: ['dashboard'],
});

export const duplicateDashboardInstalledPlugin = async (
  baseId: string,
  id: string,
  installedId: string,
  duplicateDashboardRo: IDuplicateDashboardInstalledPluginRo
) => {
  return axios.post<{ id: string; name: string }>(
    urlBuilder(DUPLICATE_DASHBOARD_INSTALLED_PLUGIN, { baseId, id, installedId }),
    duplicateDashboardRo
  );
};
