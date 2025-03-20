import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { z } from '../../zod';
import type { IGetUserLastVisitRo } from './get';
import { getUserLastVisitRoSchema, userLastVisitVoSchema } from './get';

export const GET_USER_LAST_VISIT_MAP = '/user/last-visit/map';

export const userLastVisitMapVoSchema = z.record(z.string(), userLastVisitVoSchema);

export type IUserLastVisitMapVo = z.infer<typeof userLastVisitMapVoSchema>;

export const GetUserLastVisitMapRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_USER_LAST_VISIT_MAP,
  description: 'Get user last visited resource map',
  request: {
    query: getUserLastVisitRoSchema,
  },
  responses: {
    200: {
      description: 'Returns data about user last visit map.',
      content: {
        'application/json': {
          schema: userLastVisitMapVoSchema,
        },
      },
    },
  },
  tags: ['user'],
});

export const getUserLastVisitMap = async (params: IGetUserLastVisitRo) => {
  return axios.get<IUserLastVisitMapVo>(GET_USER_LAST_VISIT_MAP, { params });
};
