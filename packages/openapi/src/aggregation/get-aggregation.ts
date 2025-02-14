import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix, StatisticsFunc } from '@teable/core';
import { axios } from '../axios';
import { contentQueryBaseSchema, queryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export { StatisticsFunc } from '@teable/core';

export const aggregationFieldSchema = z.object({
  fieldId: z.string(),
  statisticFunc: z.nativeEnum(StatisticsFunc),
});

export type IAggregationField = z.infer<typeof aggregationFieldSchema>;

export const aggregationRoSchema = queryBaseSchema
  .merge(contentQueryBaseSchema.pick({ groupBy: true }))
  .extend({
    field: z.record(z.nativeEnum(StatisticsFunc), z.string().array()).optional(),
  });

export type IAggregationRo = z.infer<typeof aggregationRoSchema>;

export const aggFuncSchema = z.nativeEnum(StatisticsFunc);

export const rawAggregationsValueSchema = z.object({
  value: z.union([z.string(), z.number()]).nullable(),
  aggFunc: aggFuncSchema,
});

export type IRawAggregationsValue = z.infer<typeof rawAggregationsValueSchema>;

export const rawAggregationsSchema = z
  .object({
    fieldId: z.string().startsWith(IdPrefix.Field).openapi({
      description: 'The id of the field.',
    }),
    total: rawAggregationsValueSchema.nullable().openapi({
      description: 'Aggregations by all data in field',
    }),
    group: z.record(z.string(), rawAggregationsValueSchema).optional().nullable().openapi({
      description: 'Aggregations by grouped data in field',
    }),
  })
  .array();

export type IRawAggregations = z.infer<typeof rawAggregationsSchema>;

export const baseRawAggregationValueSchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View),
  aggregations: rawAggregationsSchema,
  rowCount: z.number(),
});

export const rawAggregationValueSchema = baseRawAggregationValueSchema
  .pick({
    aggregations: true,
  })
  .partial();

export type IRawAggregationValue = z.infer<typeof rawAggregationValueSchema>;

export const aggregationVoSchema = rawAggregationValueSchema;

export type IAggregationVo = z.infer<typeof aggregationVoSchema>;

export const GET_AGGREGATION_LIST = '/table/{tableId}/aggregation';

export const GetAggregationRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_AGGREGATION_LIST,
  summary: 'Get aggregated statistics',
  description:
    'Returns statistical aggregations of table data based on specified functions and grouping criteria',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: z.object({}),
  },
  responses: {
    200: {
      description: 'Returns aggregations list.',
      content: {
        'application/json': {
          schema: z.array(aggregationVoSchema),
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getAggregation = async (tableId: string, query?: IAggregationRo) => {
  return axios.get<IAggregationVo>(urlBuilder(GET_AGGREGATION_LIST, { tableId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
      groupBy: JSON.stringify(query?.groupBy),
    },
  });
};
