import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const RENAME_DASHBOARD = '/base/{baseId}/dashboard/{dashboardId}/rename';

export const renameDashboardRoSchema = z.object({
  name: z.string(),
});

export type IRenameDashboardRo = z.infer<typeof renameDashboardRoSchema>;

export const renameDashboardVoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type IRenameDashboardVo = z.infer<typeof renameDashboardVoSchema>;

export const RenameDashboardRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: RENAME_DASHBOARD,
  description: 'Rename a dashboard by id',
  request: {
    params: z.object({
      baseId: z.string(),
      dashboardId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: renameDashboardRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns data about the renamed dashboard.',
      content: {
        'application/json': {
          schema: renameDashboardVoSchema,
        },
      },
    },
  },
  tags: ['dashboard'],
});

export const renameDashboard = async (baseId: string, dashboardId: string, name: string) => {
  return axios.patch<IRenameDashboardVo>(urlBuilder(RENAME_DASHBOARD, { baseId, dashboardId }), {
    name,
  });
};
