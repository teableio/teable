import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { contentQueryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const recordIndexRoSchema = contentQueryBaseSchema.extend({
  recordId: z.string(),
});

export type IRecordIndexRo = z.infer<typeof recordIndexRoSchema>;

export const recordIndexVoSchema = z
  .object({
    index: z.number(),
  })
  .nullable();

export type IRecordIndexVo = z.infer<typeof recordIndexVoSchema>;

export const GET_RECORD_INDEX = '/table/{tableId}/aggregation/record-index';

export const GetRecordIndexRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_RECORD_INDEX,
  summary: 'Get record index',
  description:
    'Returns the 0-based row index of a specific record in the current query context (respecting view filters, sort order, link filters)',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: recordIndexRoSchema,
  },
  responses: {
    200: {
      description: 'Record index in the current query context',
      content: {
        'application/json': {
          schema: recordIndexVoSchema,
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getRecordIndex = async (tableId: string, query: IRecordIndexRo) => {
  return axios.get<IRecordIndexVo>(urlBuilder(GET_RECORD_INDEX, { tableId }), {
    params: {
      ...query,
      filter: query.filter ? JSON.stringify(query.filter) : undefined,
      orderBy: query.orderBy ? JSON.stringify(query.orderBy) : undefined,
    },
  });
};
