import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import {
  searchMatchesRoSchema,
  searchMatchesVoSchema,
  type ISearchMatchesVo,
} from '../aggregation';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_SEARCH_MATCHES = '/share/{shareId}/view/search-matches';

export const shareViewSearchMatchesRoSchema = searchMatchesRoSchema.omit({
  viewId: true,
  ignoreViewQuery: true,
});
export type IShareViewSearchMatchesRo = z.infer<typeof shareViewSearchMatchesRoSchema>;

export const GetShareViewSearchMatchesRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SHARE_VIEW_SEARCH_MATCHES,
  description:
    'Returns visible matching cells for a shared show-all view. Each page holds up to `take` matching rows (not view rows): `skip` advances over matching rows, and every hit carries its absolute View row index. The read-only query is sent as JSON so selected record IDs and view criteria do not expand the URL. hideNotMatchRow=true is rejected; use the existing search-index API for hide mode.',
  request: {
    params: z.object({ shareId: z.string() }),
    body: {
      required: true,
      content: { 'application/json': { schema: shareViewSearchMatchesRoSchema } },
    },
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
  return axios.post<ISearchMatchesVo>(urlBuilder(SHARE_VIEW_SEARCH_MATCHES, { shareId }), query);
};
