import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { queryBaseSchema, contentQueryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const searchIndexVoSchema = z
  .object({
    index: z.number(),
    fieldId: z.string(),
  })
  .array()
  .nullable();

export type ISearchIndexVo = z.infer<typeof searchIndexVoSchema>;

export const searchIndexByQueryRoSchema = contentQueryBaseSchema.extend({
  skip: z.coerce.number().optional(),
  take: z.coerce.number(),
});

export type ISearchIndexByQueryRo = z.infer<typeof searchIndexByQueryRoSchema>;

export const GET_Search_INDEX = '/table/{tableId}/aggregation/search-index';

export const GetSearchIndexRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_Search_INDEX,
  description: 'Get record index with search query',
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
