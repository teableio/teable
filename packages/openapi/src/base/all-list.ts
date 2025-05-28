import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { IGetBaseVo } from './get';
import { getBaseItemSchema } from './get';

export const GET_BASE_ALL = '/base/access/all';

export type IGetBaseAllVo = Omit<IGetBaseVo, 'collaboratorType'>[];

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
          schema: z.array(getBaseItemSchema),
        },
      },
    },
  },
  tags: ['base'],
});

export const getBaseAll = async () => {
  return axios.get<IGetBaseAllVo>(GET_BASE_ALL);
};
