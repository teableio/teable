import { z } from 'zod';
import { IdPrefix } from '../../utils';
import { StatisticsFunc } from '../aggregation';

export const fieldsViewVisibleRoSchema = z.object({
  viewFields: z
    .object({
      fieldId: z.string().startsWith(IdPrefix.Field).length(19),
      hidden: z.boolean(),
    })
    .array()
    .nonempty(),
});

export type IColumnMeta = z.infer<typeof columnMetaSchema>;

export type IColumn = z.infer<typeof columnSchema>;

export const columnSchema = z.object({
  order: z.number().openapi({
    description: 'Order is a floating number, column will sort by it in the view.',
  }),
  width: z.number().optional().openapi({
    description: 'Column width in the view.',
  }),
  hidden: z.boolean().optional().openapi({
    description: 'If column hidden in the view.',
  }),
  statisticFunc: z.nativeEnum(StatisticsFunc).nullable().optional().openapi({
    description: 'Statistic function of the column in the view.',
  }),
  required: z.boolean().optional().openapi({
    description: 'If column is required',
  }),
});

export const columnMetaSchema = z.record(z.string().startsWith(IdPrefix.Field), columnSchema);

export const columnMetaRoSchema = z
  .object({
    fieldId: z
      .string()
      .startsWith(IdPrefix.Field)
      .describe('field id')
      .openapi({ description: 'field id' }),
    columnMeta: columnSchema
      .partial()
      .refine((v) => Object.keys(v).length > 0, 'At least fill any of column meta'),
  })
  .array();

export type IColumnMetaRo = z.infer<typeof columnMetaRoSchema>;

export type IFieldsViewVisibleRo = z.infer<typeof fieldsViewVisibleRoSchema>;
