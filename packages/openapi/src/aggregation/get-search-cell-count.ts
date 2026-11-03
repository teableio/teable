import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { searchCountRoSchema } from './get-search-count';

export const searchCellCountRoSchema = searchCountRoSchema.extend({
  projection: z.array(z.string().startsWith(IdPrefix.Field)).optional().meta({
    description: 'Limit matching cells to these visible fields',
  }),
});

export type ISearchCellCountRo = z.infer<typeof searchCellCountRoSchema>;

export const searchCellCountVoSchema = z.object({
  matchedCellCount: z.number(),
});

export type ISearchCellCountVo = z.infer<typeof searchCellCountVoSchema>;

export const GET_SEARCH_CELL_COUNT = '/table/{tableId}/aggregation/search-cell-count';

export const GetSearchCellCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SEARCH_CELL_COUNT,
  summary: 'Count matching cells',
  description:
    'Returns the exact number of visible cells matching the search within the filtered view scope',
  request: {
    params: z.object({ tableId: z.string() }),
    query: searchCellCountRoSchema,
  },
  responses: {
    200: {
      description: 'Exact matching cell count',
      content: { 'application/json': { schema: searchCellCountVoSchema } },
    },
  },
  tags: ['aggregation'],
});

export const getSearchCellCount = async (tableId: string, query?: ISearchCellCountRo) => {
  return axios.get<ISearchCellCountVo>(urlBuilder(GET_SEARCH_CELL_COUNT, { tableId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
    },
  });
};
