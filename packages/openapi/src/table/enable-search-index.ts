import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const TOGGLE_TABLE_SEARCH_INDEX = '/base/{baseId}/table/{tableId}/search-index';

export const toggleSearchIndexRoSchema = z.object({
  type: z.enum(['tsVector', 'trgmIndex']),
});

export type IToggleSearchIndexRo = z.infer<typeof toggleSearchIndexRoSchema>;

export const ToggleTableSearchRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TOGGLE_TABLE_SEARCH_INDEX,
  description: 'Create a table',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: toggleSearchIndexRoSchema,
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

export const toggleTableSearchIndex = async (
  baseId: string,
  tableId: string,
  searchIndexRo: IToggleSearchIndexRo
) => {
  return axios.post<void>(
    urlBuilder(TOGGLE_TABLE_SEARCH_INDEX, { baseId, tableId }),
    searchIndexRo
  );
};
