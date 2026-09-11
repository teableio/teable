import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { IGetBaseVo } from './get';
import { getBaseItemSchema } from './get';

export const GET_BASE_ALL = '/base/access/all';

export const BASE_LIST_ORDER_BY = ['space', 'personal'] as const;
export type IBaseListOrderBy = (typeof BASE_LIST_ORDER_BY)[number];

export const getBaseAllRoSchema = z.object({
  /**
   * `space` (default): the space's shared order, what every member sees.
   * `personal`: the caller's own arrangement — bases they rearranged in their saved order,
   * bases they have not arranged yet first by last visit, never-visited ones last in the
   * shared order. Items then carry `personalOrder` where one is saved.
   */
  orderBy: z.enum(BASE_LIST_ORDER_BY).optional(),
});

export type IGetBaseAllRo = z.infer<typeof getBaseAllRoSchema>;

export type IGetBaseAllVo = Omit<IGetBaseVo, 'collaboratorType'>[];

export const GetBaseAllRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_ALL,
  summary: 'Get all base list',
  description: 'Get all bases that the current user has access to',
  request: {
    query: getBaseAllRoSchema,
  },
  responses: {
    200: {
      description: 'Returns the list of bases accessible to the current user.',
      content: {
        'application/json': {
          schema: z.array(getBaseItemSchema),
        },
      },
    },
  },
  tags: ['base'],
});

export const getBaseAll = async (query?: IGetBaseAllRo) => {
  return axios.get<IGetBaseAllVo>(GET_BASE_ALL, { params: query });
};
