import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { dashboardLayoutSchema } from './types';

export const UPDATE_LAYOUT_DASHBOARD = '/base/{baseId}/dashboard/{id}/layout';

export const updateLayoutDashboardRoSchema = z.object({
  layout: dashboardLayoutSchema,
});

export type IUpdateLayoutDashboardRo = z.infer<typeof updateLayoutDashboardRoSchema>;

export const updateLayoutDashboardVoSchema = z.object({
  id: z.string(),
  layout: dashboardLayoutSchema,
});

export type IUpdateLayoutDashboardVo = z.infer<typeof updateLayoutDashboardVoSchema>;

export const UpdateLayoutDashboardRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_LAYOUT_DASHBOARD,
  description: 'Update a dashboard layout by id',
  request: {
    params: z.object({
      baseId: z.string(),
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateLayoutDashboardRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns data about the updated dashboard layout.',
      content: {
        'application/json': {
          schema: updateLayoutDashboardVoSchema,
        },
      },
    },
  },
  tags: ['dashboard'],
});

export const updateLayoutDashboard = async (
  baseId: string,
  id: string,
  layout: IUpdateLayoutDashboardRo['layout']
) => {
  return axios.patch<IUpdateLayoutDashboardVo>(
    urlBuilder(UPDATE_LAYOUT_DASHBOARD, { baseId, id }),
    { layout }
  );
};
