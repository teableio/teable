import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import {
  searchCellCountRoSchema,
  searchCellCountVoSchema,
  type ISearchCellCountVo,
} from '../aggregation';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_SHARE_VIEW_SEARCH_CELL_COUNT = '/share/{shareId}/view/search-cell-count';

export const shareViewSearchCellCountRoSchema = searchCellCountRoSchema.omit({
  viewId: true,
  ignoreViewQuery: true,
});
export type IShareViewSearchCellCountRo = z.infer<typeof shareViewSearchCellCountRoSchema>;

export const GetShareViewSearchCellCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SHARE_VIEW_SEARCH_CELL_COUNT,
  description: 'Count visible matching cells in a shared view',
  request: {
    params: z.object({ shareId: z.string() }),
    query: shareViewSearchCellCountRoSchema,
  },
  responses: {
    200: {
      description: 'Exact shared-view matching cell count',
      content: { 'application/json': { schema: searchCellCountVoSchema } },
    },
  },
  tags: ['share'],
});

export const getShareViewSearchCellCount = async (
  shareId: string,
  query?: IShareViewSearchCellCountRo
) => {
  return axios.get<ISearchCellCountVo>(urlBuilder(GET_SHARE_VIEW_SEARCH_CELL_COUNT, { shareId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
    },
  });
};
