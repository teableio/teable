import { z } from 'zod';
import { IdPrefix } from '../../utils';
import { StatisticsFunc } from '../view';

export const aggregationsValueSchema = z.object({
  value: z.union([z.string(), z.number()]),
  aggFunc: z.nativeEnum(StatisticsFunc),
});

export type IAggregationsValue = z.infer<typeof aggregationsValueSchema>;

export const aggregationsSchema = z.record(
  z.string().startsWith(IdPrefix.Field),
  z.union([
    z.object({ total: aggregationsValueSchema }),
    z.record(z.union([z.literal('total'), z.string()]), aggregationsValueSchema),
  ])
);

export type IAggregations = z.infer<typeof aggregationsSchema>;
export const viewAggregationValueSchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View),
  executionTime: z.number(),
  aggregations: aggregationsSchema,
});

export type IViewAggregationValue = z.infer<typeof viewAggregationValueSchema>;

export const viewAggregationSchema = z.record(
  z.string().startsWith(IdPrefix.View),
  viewAggregationValueSchema
);

export type IViewAggregationVo = z.infer<typeof viewAggregationSchema>;
