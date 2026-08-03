import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DUPLICATE_DASHBOARD = '/base/{baseId}/dashboard/{id}/duplicate';

export const duplicateDashboardRoSchema = z.object({
  name: z.string().optional(),
});

export type IDuplicateDashboardRo = z.infer<typeof duplicateDashboardRoSchema>;

export const duplicateDashboardRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DUPLICATE_DASHBOARD,
  description: 'Duplicate a dashboard',
  summary: 'Duplicate a dashboard',
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

export const duplicateDashboard = async (
  baseId: string,
  id: string,
  duplicateDashboardRo: IDuplicateDashboardRo
) => {
  return axios.post<{ id: string; name: string }>(
    urlBuilder(DUPLICATE_DASHBOARD, { baseId, id }),
    duplicateDashboardRo
  );
};
