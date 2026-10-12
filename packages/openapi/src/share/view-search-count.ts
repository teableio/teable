import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { ISearchCountVo } from '../aggregation';
import { searchCountRoSchema, searchCountVoSchema } from '../aggregation';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_SHARE_VIEW_SEARCH_COUNT = '/share/{shareId}/view/search-count';

export const shareViewSearchCountRoSchema = searchCountRoSchema.omit({
  // viewId is bound by the shareId; ignoreViewQuery must not be exposed — it would
  // drop the view's row filter and let hidden columns be searched.
  viewId: true,
  ignoreViewQuery: true,
});

export type IShareViewSearchCountRo = z.infer<typeof shareViewSearchCountRoSchema>;

export const GetShareViewSearchCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SHARE_VIEW_SEARCH_COUNT,
  description: 'Get share view search result count with query',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: shareViewSearchCountRoSchema,
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
  tags: ['share'],
});

export const getShareViewSearchCount = async (shareId: string, query?: IShareViewSearchCountRo) => {
  return axios.get<ISearchCountVo>(urlBuilder(GET_SHARE_VIEW_SEARCH_COUNT, { shareId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
    },
  });
};
