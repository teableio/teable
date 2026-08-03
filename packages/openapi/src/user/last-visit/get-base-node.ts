import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import { userLastVisitVoSchema } from './get';

export const GET_USER_LAST_VISIT_BASE_NODE = '/user/last-visit/base-node';

export const getUserLastVisitBaseNodeRoSchema = z.object({
  parentResourceId: z.string(),
});

export type IGetUserLastVisitBaseNodeRo = z.infer<typeof getUserLastVisitBaseNodeRoSchema>;

export const userLastVisitBaseNodeVoSchema = userLastVisitVoSchema.optional();

export type IUserLastVisitBaseNodeVo = z.infer<typeof userLastVisitBaseNodeVoSchema>;

export const GetUserLastVisitBaseNodeRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_USER_LAST_VISIT_BASE_NODE,
  description: 'Get user last visited base node',
  request: {
    query: getUserLastVisitBaseNodeRoSchema,
  },
  responses: {
    200: {
      description: 'Returns data about user last visit base node.',
      content: {
        'application/json': {
          schema: userLastVisitBaseNodeVoSchema,
        },
      },
    },
  },
  tags: ['user'],
});

export const getUserLastVisitBaseNode = async (params: IGetUserLastVisitBaseNodeRo) => {
  return axios.get<IUserLastVisitBaseNodeVo>(urlBuilder(GET_USER_LAST_VISIT_BASE_NODE, {}), {
    params,
  });
};
