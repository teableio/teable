import { z } from 'zod';
import { IdPrefix } from '../../utils';

export const aggregatesValueSchema = z.object({
  fieldId: z.string().startsWith(IdPrefix.Field),
  value: z.string(),
  funcName: z.string(),
});

export type IAggregatesValue = z.infer<typeof aggregatesValueSchema>;

export const aggregatesSchema = z.record(
  z.string().startsWith(IdPrefix.Field),
  aggregatesValueSchema
);

export type IAggregates = z.infer<typeof aggregatesSchema>;
export const viewAggregateValueSchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View),
  rowCount: z.number(),
  executionTime: z.number(),
  aggregates: aggregatesSchema,
});

export type IViewAggregateValue = z.infer<typeof viewAggregateValueSchema>;

export const viewAggregateSchema = z.record(
  z.string().startsWith(IdPrefix.View),
  viewAggregateValueSchema
);

export type IViewAggregateVo = z.infer<typeof viewAggregateSchema>;
