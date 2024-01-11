import { IdPrefix } from '../../utils';
import { z } from '../../zod';
import { contentQueryBaseSchema, queryBaseSchema } from '../record/record.schema';
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

export const rawRowCountValueSchema = baseRawAggregationValueSchema.pick({
  rowCount: true,
});

export type IRawRowCountValue = z.infer<typeof rawRowCountValueSchema>;

export const rowCountVoSchema = rawRowCountValueSchema;

export type IRowCountVo = z.infer<typeof rowCountVoSchema>;

export const aggregationFieldSchema = z.object({
  fieldId: z.string(),
  statisticFunc: z.nativeEnum(StatisticsFunc),
});

export type IAggregationField = z.infer<typeof aggregationFieldSchema>;

export const aggregationRoSchema = queryBaseSchema.extend({
  field: z.record(z.nativeEnum(StatisticsFunc), z.string().array()).optional(),
});

export type IAggregationRo = z.infer<typeof aggregationRoSchema>;

export const groupPointsRoSchema = contentQueryBaseSchema.pick({
  viewId: true,
  filter: true,
  groupBy: true,
});

export type IGroupPointsRo = z.infer<typeof groupPointsRoSchema>;

export enum GroupPointType {
  Header = 0,
  Row = 1,
}

const groupHeaderPointSchema = z.object({
  id: z.string(),
  type: z.literal(GroupPointType.Header),
  depth: z.number().max(2).min(0),
  value: z.unknown(),
});

const groupRowPointSchema = z.object({
  type: z.literal(GroupPointType.Row),
  count: z.number(),
});

const groupPointSchema = z.union([groupHeaderPointSchema, groupRowPointSchema]);

export type IGroupHeaderPoint = z.infer<typeof groupHeaderPointSchema>;

export type IGroupPoint = z.infer<typeof groupPointSchema>;

export const groupPointsVoSchema = groupPointSchema.array().nullable();

export type IGroupPointsVo = z.infer<typeof groupPointsVoSchema>;
