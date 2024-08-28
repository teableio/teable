import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_DASHBOARD = '/base/{baseId}/dashboard/{id}';

export const DeleteDashboardRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_DASHBOARD,
  description: 'Delete a dashboard by id',
  request: {
    params: z.object({
      baseId: z.string(),
      id: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Dashboard deleted',
    },
  },
  tags: ['dashboard'],
});

export const deleteDashboard = async (baseId: string, id: string) => {
  return axios.delete(urlBuilder(DELETE_DASHBOARD, { baseId, id }));
};
