import { IdPrefix } from '../../utils';
import { z } from '../../zod';
import { filterSchema } from '../view/filter/filter';
import { StatisticsFunc } from './statistics-func.enum';

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

const baseRawAggregationValueSchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View),
  executionTime: z.number(),
  aggregations: rawAggregationsSchema,
  rowCount: z.number(),
});

export const rawAggregationValueSchema = baseRawAggregationValueSchema.omit({
  rowCount: true,
});

export type IRawAggregationValue = z.infer<typeof rawAggregationValueSchema>;

export const rawAggregationSchema = z.record(
  z.string().startsWith(IdPrefix.View),
  rawAggregationValueSchema
);

export type IRawAggregationVo = z.infer<typeof rawAggregationSchema>;

export type IAggregations = z.infer<typeof rawAggregationsSchema>;
export const viewAggregationSchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View),
  aggregations: rawAggregationsSchema.optional(),
});

export type IViewAggregationVo = z.infer<typeof viewAggregationSchema>;

export const rawRowCountValueSchema = baseRawAggregationValueSchema.omit({
  aggregations: true,
});

export type IRawRowCountValue = z.infer<typeof rawRowCountValueSchema>;

export const rawRowCountSchema = z.record(
  z.string().startsWith(IdPrefix.View),
  rawRowCountValueSchema
);

export type IRawRowCountVo = z.infer<typeof rawRowCountSchema>;

export const viewRowCountRoSchema = z.object({
  filter: filterSchema.optional(),
});

export type IViewRowCountRo = z.infer<typeof viewRowCountRoSchema>;

export const viewRowCountSchema = z.object({
  rowCount: z.number(),
});

export type IViewRowCountVo = z.infer<typeof viewRowCountSchema>;

export const viewAggregationRoSchema = z.object({
  field: z.record(z.nativeEnum(StatisticsFunc), z.string().array()).optional(),
  filter: filterSchema.optional(),
});

export type IViewAggregationRo = z.infer<typeof viewAggregationRoSchema>;
