import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import type { IGetBaseAllVo } from '../base';
import { BASE_LIST_ORDER_BY, getBaseItemSchema } from '../base';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_BASE_LIST = '/space/{spaceId}/base';

export const getBaseListRoSchema = z.object({
  spaceId: z.string(),
});

export type IGetBasesListRo = z.infer<typeof getBaseListRoSchema>;

export const getBaseListQuerySchema = z.object({
  /**
   * The same arrangement `GET /base/access/all` offers, for one space: `space` (default) is
   * the shared order every member sees, `personal` the caller's own. A screen showing one
   * space wants its own order without downloading every other space to get it.
   */
  orderBy: z.enum(BASE_LIST_ORDER_BY).optional(),
});

export type IGetBaseListQuery = z.infer<typeof getBaseListQuerySchema>;

export const GetBaseListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_LIST,
  title: 'List projects in space',
  description: 'List projects in the specified space using the supplied query.',
  request: {
    params: getBaseListRoSchema,
    query: getBaseListQuerySchema,
  },
  responses: {
    200: {
      description: 'Returns the list of project.',
      content: {
        'application/json': {
          schema: z.array(getBaseItemSchema),
        },
      },
    },
  },
  tags: ['base'],
});

export const getBaseList = async (ro: IGetBasesListRo, query?: IGetBaseListQuery) => {
  return axios.get<IGetBaseAllVo>(urlBuilder(GET_BASE_LIST, ro), { params: query });
};
