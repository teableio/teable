import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { searchIndexVoSchema } from '../aggregation';
import type { ISearchIndexVo, ISearchIndexByQueryRo } from '../aggregation';
import { axios } from '../axios';
import { queryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_SHARE_VIEW_SEARCH_INDEX = '/share/{shareId}/view/search-index';

export const GetShareViewSearchIndexRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SHARE_VIEW_SEARCH_INDEX,
  description: 'Get share view record index with search query',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: queryBaseSchema,
  },
  responses: {
    200: {
      description: 'share view record index with search query',
      content: {
        'application/json': {
          schema: searchIndexVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const getShareViewSearchIndex = async (shareId: string, query?: ISearchIndexByQueryRo) => {
  return axios.get<ISearchIndexVo>(urlBuilder(GET_SHARE_VIEW_SEARCH_INDEX, { shareId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
      orderBy: JSON.stringify(query?.orderBy),
      groupBy: JSON.stringify(query?.groupBy),
    },
  });
};
