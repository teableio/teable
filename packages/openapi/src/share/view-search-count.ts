import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { ISearchCountRo, ISearchCountVo } from '../aggregation';
import { searchCountRoSchema } from '../aggregation';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const searchCountVoSchema = z.object({
  count: z.number(),
});

export const GET_SHARE_VIEW_SEARCH_COUNT = '/share/{shareId}/view/search-count';

export const GetShareViewSearchCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SHARE_VIEW_SEARCH_COUNT,
  description: 'Get share view search result count with query',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: searchCountRoSchema,
  },
  responses: {
    200: {
      description: 'Share view Search count with query',
      content: {
        'application/json': {
          schema: searchCountVoSchema,
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getShareViewSearchCount = async (shareId: string, query?: ISearchCountRo) => {
  return axios.get<ISearchCountVo>(urlBuilder(GET_SHARE_VIEW_SEARCH_COUNT, { shareId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
    },
  });
};
