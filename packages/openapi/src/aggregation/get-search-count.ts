import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { queryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const searchCountVoSchema = z.object({
  count: z.number(),
});

export type ISearchCountVo = z.infer<typeof searchCountVoSchema>;

export const GET_Search_COUNT = '/table/{tableId}/aggregation/search-count';

export const searchCountRoSchema = queryBaseSchema.pick({
  filter: true,
  viewId: true,
  search: true,
});

export type ISearchCountRo = z.infer<typeof searchCountRoSchema>;

export const GetSearchCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_Search_COUNT,
  description: 'Get search result count with query',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: searchCountRoSchema,
  },
  responses: {
    200: {
      description: 'Search count with query',
      content: {
        'application/json': {
          schema: searchCountVoSchema,
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getSearchCount = async (tableId: string, query?: ISearchCountRo) => {
  return axios.get<ISearchCountVo>(urlBuilder(GET_Search_COUNT, { tableId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
    },
  });
};
