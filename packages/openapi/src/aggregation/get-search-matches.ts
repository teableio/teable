import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { searchIndexByQueryRoSchema, searchMatchSchema } from './get-search-by-index';

export const searchMatchesRoSchema = searchIndexByQueryRoSchema;
export type ISearchMatchesRo = z.infer<typeof searchMatchesRoSchema>;

export const searchMatchesVoSchema = z.object({
  matches: searchMatchSchema.array(),
  scannedRecordCount: z.number(),
  nextSkip: z.number().nullable(),
  hasMore: z.boolean(),
});

export type ISearchMatchesVo = z.infer<typeof searchMatchesVoSchema>;

export const GET_SEARCH_MATCHES = '/table/{tableId}/aggregation/search-matches';

export const GetSearchMatchesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SEARCH_MATCHES,
  summary: 'Scan matching cells',
  description:
    'Returns visible matching cells for a bounded show-all record page plus explicit scan pagination metadata. hideNotMatchRow=true is rejected; use the existing search-index API for hide mode.',
  request: {
    params: z.object({ tableId: z.string() }),
    query: searchMatchesRoSchema,
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
  return axios.get<ISearchMatchesVo>(urlBuilder(GET_SEARCH_MATCHES, { tableId }), {
    params: {
      ...query,
      filter: JSON.stringify(query.filter),
      orderBy: JSON.stringify(query.orderBy),
      groupBy: JSON.stringify(query.groupBy),
    },
  });
};
