import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { dashboardLayoutSchema, dashboardPluginItemSchema } from './types';

export const GET_DASHBOARD = '/base/{baseId}/dashboard/{id}';

export const getDashboardVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  layout: dashboardLayoutSchema.optional(),
  pluginMap: z.record(z.string(), dashboardPluginItemSchema).optional(),
});

export type IGetDashboardVo = z.infer<typeof getDashboardVoSchema>;

export const GetDashboardRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_DASHBOARD,
  description: 'Get a dashboard by id',
  request: {
    params: z.object({
      baseId: z.string(),
      id: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about the dashboard.',
      content: {
        'application/json': {
          schema: getDashboardVoSchema,
        },
      },
    },
  },
  tags: ['dashboard'],
});

export const getDashboard = async (baseId: string, id: string) => {
  return axios.get<IGetDashboardVo>(urlBuilder(GET_DASHBOARD, { baseId, id }));
};
