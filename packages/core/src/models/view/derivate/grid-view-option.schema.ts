import { z } from '../../../zod';
import { RowHeightLevel } from '../constant';

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
  })
  .strict();

export type IGridViewOptions = z.infer<typeof gridViewOptionSchema>;
