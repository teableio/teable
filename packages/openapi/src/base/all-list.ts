import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';
import type { IGetBaseVo } from './get';
import { getBaseVoSchema } from './get';

export const GET_BASE_ALL = '/base/access/all';

export const GetBaseAllRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_ALL,
  description: 'Get base list by query',
  request: {},
  responses: {
    200: {
      description: 'Returns the list of base.',
      content: {
        'application/json': {
          schema: z.array(getBaseVoSchema),
        },
      },
    },
  },
  tags: ['base'],
});

export const getBaseAll = async () => {
  return axios.get<IGetBaseVo[]>(GET_BASE_ALL);
};
