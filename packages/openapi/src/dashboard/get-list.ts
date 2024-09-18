import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_DASHBOARD_LIST = '/base/{baseId}/dashboard';

export const getDashboardListVoSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
  })
);

export type IGetDashboardListVo = z.infer<typeof getDashboardListVoSchema>;

export const GetDashboardListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_DASHBOARD_LIST,
  description: 'Get a list of dashboards in base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about the dashboards.',
      content: {
        'application/json': {
          schema: z.array(getDashboardListVoSchema),
        },
      },
    },
  },
  tags: ['dashboard'],
});

export const getDashboardList = async (baseId: string) => {
  return axios.get<IGetDashboardListVo>(urlBuilder(GET_DASHBOARD_LIST, { baseId }));
};
