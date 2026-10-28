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
  /** Only bases in this space. */
  spaceId: z.string().optional(),
  /** Case-insensitive match on the base name or ID. */
  search: z.string().optional(),
  /** Paging over the ordered list; omit both to get every base. */
  skip: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).optional(),
});

export type IGetBaseAllRo = z.infer<typeof getBaseAllRoSchema>;

export type IGetBaseAllVo = Omit<IGetBaseVo, 'collaboratorType'>[];

export const GetBaseAllRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_ALL,
  title: 'List accessible projects',
  summary: 'Get all project list',
  description: 'List projects accessible to the current user using the supplied query.',
  request: {
    query: getBaseAllRoSchema,
  },
  responses: {
    200: {
      description: 'Returns the list of projects accessible to the current user.',
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

export interface IGetBaseAllPageRo {
  spaceId?: string;
  search?: string;
  offset: number;
  limit: number;
}

/**
 * One page of the accessible bases, filtered and paged by the server. Fetches one extra row to
 * tell whether another page follows, so no count over the whole list is needed.
 */
export const getBaseAllPage = async ({ offset, limit, ...filter }: IGetBaseAllPageRo) => {
  const { data } = await getBaseAll({ ...filter, skip: offset, take: limit + 1 });
  return { bases: data.slice(0, limit), hasMore: data.length > limit };
};
