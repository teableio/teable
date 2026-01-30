import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { ResourceType } from '../../types';
import { registerRoute } from '../../utils';
import { z } from '../../zod';

export const GET_USER_LAST_VISIT = '/user/last-visit';

export enum LastVisitResourceType {
  Space = ResourceType.Space,
  Base = ResourceType.Base,
  Table = ResourceType.Table,
  View = ResourceType.View,
  Dashboard = ResourceType.Dashboard,
  Workflow = ResourceType.Workflow,
  App = ResourceType.App,
}

export const userLastVisitVoSchema = z.object({
  resourceType: z.enum(LastVisitResourceType),
  resourceId: z.string(),
  childResourceId: z.string().optional(),
});

export type IUserLastVisitVo = z.infer<typeof userLastVisitVoSchema>;

export const getUserLastVisitRoSchema = z.object({
  resourceType: z.enum(LastVisitResourceType),
  parentResourceId: z.string(),
});

export type IGetUserLastVisitRo = z.infer<typeof getUserLastVisitRoSchema>;

export const GetUserLastVisitRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_USER_LAST_VISIT,
  description: 'Get user last visited resource',
  request: {
    query: getUserLastVisitRoSchema,
  },
  responses: {
    200: {
      description: 'Returns data about user last visit.',
      content: {
        'application/json': {
          schema: userLastVisitVoSchema.optional(),
        },
      },
    },
  },
  tags: ['user'],
});

export const getUserLastVisit = async (params: IGetUserLastVisitRo) => {
  return axios.get<IUserLastVisitVo | undefined>(GET_USER_LAST_VISIT, { params });
};
