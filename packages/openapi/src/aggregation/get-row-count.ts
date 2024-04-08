import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import type { IQueryBaseRo } from '../record';
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

export const GET_ROW_COUNT = '/table/{tableId}/aggregation/row-count';

export const GetRowCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_ROW_COUNT,
  description: 'Get row count for the view',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: queryBaseSchema,
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

export const getRowCount = async (tableId: string, query?: IQueryBaseRo) => {
  return axios.get<IRowCountVo>(urlBuilder(GET_ROW_COUNT, { tableId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
    },
  });
};
