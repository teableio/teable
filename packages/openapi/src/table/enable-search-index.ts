import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const ENABLE_TABLE_SEARCH_INDEX = '/base/{baseId}/table/{tableId}/search-index';

export const enableSearchIndexRoSchema = z.object({
  enable: z.boolean(),
});

export type IEnableSearchIndexRo = z.infer<typeof enableSearchIndexRoSchema>;

export const EnableTableSearchRoute: RouteConfig = registerRoute({
  method: 'post',
  path: ENABLE_TABLE_SEARCH_INDEX,
  description: 'Create a table',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: enableSearchIndexRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns data about a table.',
    },
  },
  tags: ['table'],
});

export const enableTableSearchIndex = async (
  baseId: string,
  tableId: string,
  searchIndexRo: IEnableSearchIndexRo
) => {
  return axios.post<void>(
    urlBuilder(ENABLE_TABLE_SEARCH_INDEX, { baseId, tableId }),
    searchIndexRo
  );
};
