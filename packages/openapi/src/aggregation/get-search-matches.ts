import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { filterSchema, groupSchema, sortItemSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { searchIndexByQueryRoSchema, searchMatchSchema } from './get-search-by-index';

export const searchMatchesRoSchema = searchIndexByQueryRoSchema.extend({
  filter: filterSchema.optional(),
  orderBy: sortItemSchema.array().optional(),
  groupBy: groupSchema.optional(),
});
export type ISearchMatchesRo = z.infer<typeof searchMatchesRoSchema>;

export const searchMatchesVoSchema = z.object({
  matches: searchMatchSchema.array(),
  scannedRecordCount: z.number(),
  nextSkip: z.number().nullable(),
  hasMore: z.boolean(),
});

export type ISearchMatchesVo = z.infer<typeof searchMatchesVoSchema>;

export const SEARCH_MATCHES = '/table/{tableId}/aggregation/search-matches';

export const GetSearchMatchesRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SEARCH_MATCHES,
  summary: 'List matching cells',
  description:
    'Returns matching cells for show-all search mode. Each page holds up to `take` matching rows (not view rows): `skip` advances over matching rows, and every hit carries its absolute View row index. Pagination does not walk preceding non-matching rows. The read-only query is sent as JSON so selected record IDs and view criteria do not expand the URL. hideNotMatchRow=true is rejected; use the existing search-index API for hide mode.',
  request: {
    params: z.object({ tableId: z.string() }),
    body: {
      required: true,
      content: { 'application/json': { schema: searchMatchesRoSchema } },
    },
  },
  responses: {
    200: {
      description: 'Matching cells and scan pagination',
      content: { 'application/json': { schema: searchMatchesVoSchema } },
    },
  },
  tags: ['aggregation'],
});

export const getSearchMatches = async (tableId: string, query: ISearchMatchesRo) => {
  return axios.post<ISearchMatchesVo>(urlBuilder(SEARCH_MATCHES, { tableId }), query);
};
