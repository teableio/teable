import { IdPrefix } from '../../utils';
import { z } from '../../zod';
import { getRecordsQuerySchema } from '../record/record.schema';
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

export const rowCountRoSchema = getRecordsQuerySchema.pick({
  viewId: true,
  filter: true,
  filterByTql: true,
  filterLinkCellCandidate: true,
  filterLinkCellSelected: true,
});

export type IRowCountRo = z.infer<typeof rowCountRoSchema>;

export const rowCountVoSchema = rawRowCountValueSchema;

export type IRowCountVo = z.infer<typeof rowCountVoSchema>;

export const aggregationRoSchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View).optional().openapi({
    description: 'The id of the view.',
  }),
  field: z.record(z.nativeEnum(StatisticsFunc), z.string().array()).optional(),
  filter: filterSchema.optional(),
});

export type IAggregationRo = z.infer<typeof aggregationRoSchema>;
