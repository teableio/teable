import { z } from 'zod';
import { IdPrefix } from '../../utils';
import { StatisticsFunc } from './statistics-func.enum';

export const aggFuncSchema = z.nativeEnum(StatisticsFunc);

export const aggregationsValueSchema = z.object({
  value: z.union([z.string(), z.number()]).nullable(),
  aggFunc: aggFuncSchema,
});

export type IAggregationsValue = z.infer<typeof aggregationsValueSchema>;

export const aggregationsSchema = z.record(
  z.string().startsWith(IdPrefix.Field),
  z
    .union([
      z.object({ total: aggregationsValueSchema }).openapi({
        description: 'Aggregations by all data in field',
      }),
      z.record(z.union([z.literal('total'), z.string()]), aggregationsValueSchema).openapi({
        description: 'Aggregations by grouped data in field',
      }),
    ])
    .nullable()
);

export type IAggregations = z.infer<typeof aggregationsSchema>;

const baseAggregationValueSchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View),
  executionTime: z.number(),
  aggregations: aggregationsSchema,
  rowCount: z.number(),
});

export const viewAggregationValueSchema = baseAggregationValueSchema.omit({
  rowCount: true,
});

export type IViewAggregationValue = z.infer<typeof viewAggregationValueSchema>;

export const viewAggregationSchema = z.record(
  z.string().startsWith(IdPrefix.View),
  viewAggregationValueSchema
);

export type IViewAggregationVo = z.infer<typeof viewAggregationSchema>;

export const viewRowCountValueSchema = baseAggregationValueSchema.omit({
  aggregations: true,
});

export type IViewRowCountValue = z.infer<typeof viewRowCountValueSchema>;

export const viewRowCountSchema = z.record(
  z.string().startsWith(IdPrefix.View),
  viewRowCountValueSchema
);

export type IViewRowCountVo = z.infer<typeof viewRowCountSchema>;

export const viewAggregationRo = z.object({
  field: z.record(z.nativeEnum(StatisticsFunc), z.string().array()).optional(),
});

export type IViewAggregationRo = z.infer<typeof viewAggregationRo>;
