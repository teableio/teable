import { z } from '../../../zod';
import { RowHeightLevel } from '../constant';
import { filterSchema } from '../filter';

export const gridRowColorBySelectFieldSchema = z
  .object({
    fieldId: z.string(),
    enabledChoiceIds: z.array(z.string()).optional(),
    strategy: z.literal('firstMatched').optional(),
  })
  .strict();

export const gridRowColorRuleSchema = z
  .object({
    id: z.string(),
    enabled: z.boolean().optional(),
    color: z.string(),
    filter: filterSchema,
    target: z.literal('row').optional(),
  })
  .strict();

export const gridRowColorSchema = z
  .object({
    mode: z.enum(['none', 'selectField', 'rules']).optional(),
    selectField: gridRowColorBySelectFieldSchema.optional(),
    rules: z.array(gridRowColorRuleSchema).max(20).optional(),
  })
  .strict();

export const gridStyleOptionSchema = z
  .object({
    stripedRows: z.boolean().optional(),
    rowColor: gridRowColorSchema.optional(),
  })
  .strict();

export const gridViewOptionSchema = z
  .object({
    rowHeight: z
      .enum(RowHeightLevel)
      .optional()
      .meta({ description: 'The row height level of row in view' }),
    fieldNameDisplayLines: z
      .number()
      .min(1)
      .max(3)
      .optional()
      .meta({ description: 'The field name display lines in view' }),
    frozenColumnCount: z.number().min(0).optional().meta({
      description:
        'The frozen column count in view. Deprecated: this field will be removed in a future release and may no longer take effect.',
    }),
    frozenFieldId: z
      .string()
      .optional()
      .meta({ description: 'Freeze to the right side of this field id in grid view' }),
    style: gridStyleOptionSchema.optional(),
  })
  .strict();

export type IGridStyleOptions = z.infer<typeof gridStyleOptionSchema>;
export type IGridRowColorOptions = z.infer<typeof gridRowColorSchema>;
export type IGridRowColorBySelectField = z.infer<typeof gridRowColorBySelectFieldSchema>;
export type IGridRowColorRule = z.infer<typeof gridRowColorRuleSchema>;
export type IGridViewOptions = z.infer<typeof gridViewOptionSchema>;
