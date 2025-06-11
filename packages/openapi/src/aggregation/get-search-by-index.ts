import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { queryBaseSchema, contentQueryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DEFAULT_MAX_SEARCH_FIELD_COUNT = Infinity;

export const searchIndexVoSchema = z
  .object({
    index: z.number(),
    fieldId: z.string(),
    recordId: z.string(),
  })
  .array()
  .nullable();

export type ISearchIndexVo = z.infer<typeof searchIndexVoSchema>;

export const searchIndexByQueryRoSchema = contentQueryBaseSchema
  .omit({
    collapsedGroupIds: true,
  })
  .extend({
    skip: z.coerce.number().optional(),
    take: z.coerce.number(),
    projection: z.array(z.string().startsWith(IdPrefix.Field)).optional().openapi({
      description:
        'If you want to get only some fields, pass in this parameter, otherwise all visible fields will be obtained',
    }),
  });

export type ISearchIndexByQueryRo = z.infer<typeof searchIndexByQueryRoSchema>;

export const GET_Search_INDEX = '/table/{tableId}/aggregation/search-index';

export const GetSearchIndexRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_Search_INDEX,
  summary: 'Get record indices for search',
  description: 'Returns the indices and record IDs of records matching the search criteria',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: queryBaseSchema,
  },
  responses: {
    200: {
      description: 'record index with search query',
      content: {
        'application/json': {
          schema: searchIndexVoSchema,
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getSearchIndex = async (tableId: string, query?: ISearchIndexByQueryRo) => {
  return axios.get<ISearchIndexVo>(urlBuilder(GET_Search_INDEX, { tableId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
      orderBy: JSON.stringify(query?.orderBy),
      groupBy: JSON.stringify(query?.groupBy),
    },
  });
};
