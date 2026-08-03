import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { queryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseRawAggregationValueSchema } from './get-aggregation';

export const rawRowCountValueSchema = baseRawAggregationValueSchema.pick({
  rowCount: true,
});

export type IRawRowCountValue = z.infer<typeof rawRowCountValueSchema>;

export const rowCountVoSchema = rawRowCountValueSchema;

export type IRowCountVo = z.infer<typeof rowCountVoSchema>;

export const rowCountRoSchema = queryBaseSchema.extend({
  projection: z.array(z.string().startsWith(IdPrefix.Field)).optional().meta({
    description:
      'Limit search matching to these fields, e.g. the visible fields of a personal view. Only affects the search condition.',
  }),
});

export type IRowCountRo = z.infer<typeof rowCountRoSchema>;

export const GET_ROW_COUNT = '/table/{tableId}/aggregation/row-count';

export const GetRowCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_ROW_COUNT,
  summary: 'Get total row count',
  description: 'Returns the total number of rows in a view based on applied filters and criteria',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: rowCountRoSchema,
  },
  responses: {
    200: {
      description: 'Row count for the view',
      content: {
        'application/json': {
          schema: rowCountVoSchema,
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getRowCount = async (tableId: string, query?: IRowCountRo) => {
  return axios.get<IRowCountVo>(urlBuilder(GET_ROW_COUNT, { tableId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
    },
  });
};
