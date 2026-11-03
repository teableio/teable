import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import {
  searchMatchesRoSchema,
  searchMatchesVoSchema,
  type ISearchMatchesVo,
} from '../aggregation';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_SHARE_VIEW_SEARCH_MATCHES = '/share/{shareId}/view/search-matches';

export const shareViewSearchMatchesRoSchema = searchMatchesRoSchema.omit({
  viewId: true,
  ignoreViewQuery: true,
});
export type IShareViewSearchMatchesRo = z.infer<typeof shareViewSearchMatchesRoSchema>;

export const GetShareViewSearchMatchesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SHARE_VIEW_SEARCH_MATCHES,
  description:
    'Scan visible matching cells in a shared show-all view. hideNotMatchRow=true is rejected; use the existing search-index API for hide mode.',
  request: {
    params: z.object({ shareId: z.string() }),
    query: shareViewSearchMatchesRoSchema,
  },
  responses: {
    200: {
      description: 'Shared-view matching cells and scan pagination',
      content: { 'application/json': { schema: searchMatchesVoSchema } },
    },
  },
  tags: ['share'],
});

export const getShareViewSearchMatches = async (
  shareId: string,
  query: IShareViewSearchMatchesRo
) => {
  return axios.get<ISearchMatchesVo>(urlBuilder(GET_SHARE_VIEW_SEARCH_MATCHES, { shareId }), {
    params: {
      ...query,
      filter: JSON.stringify(query.filter),
      orderBy: JSON.stringify(query.orderBy),
      groupBy: JSON.stringify(query.groupBy),
    },
  });
};
