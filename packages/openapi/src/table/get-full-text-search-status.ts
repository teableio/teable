import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const FULL_TEXT_SEARCH_STATUS =
  '/base/{baseId}/table/{tableId}/full-text-search-index/status';

export const FullTextSearchStatusRoute: RouteConfig = registerRoute({
  method: 'post',
  path: FULL_TEXT_SEARCH_STATUS,
  description: '',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Returns table full text search index status',
      content: {
        'application/json': {
          schema: z.array(z.string()),
        },
      },
    },
  },
  tags: ['table'],
});

export const getFullTextSearchStatus = (baseId: string, tableId: string) => {
  return axios.get<string[]>(urlBuilder(FULL_TEXT_SEARCH_STATUS, { baseId, tableId }));
};
