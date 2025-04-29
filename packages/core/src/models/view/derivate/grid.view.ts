import z from 'zod';
import type { IGridColumnMeta } from '../column-meta.schema';
import { RowHeightLevel } from '../constant';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';

export interface IGridView extends IViewVo {
  type: ViewType.Grid;
  options: IGridViewOptions;
}

export type IGridViewOptions = z.infer<typeof gridViewOptionSchema>;

export const gridViewOptionSchema = z
  .object({
    rowHeight: z
      .nativeEnum(RowHeightLevel)
      .optional()
      .openapi({ description: 'The row height level of row in view' }),
    fieldNameDisplayLines: z
      .number()
      .min(1)
      .max(3)
      .optional()
      .openapi({ description: 'The field name display lines in view' }),
    frozenColumnCount: z
      .number()
      .min(0)
      .optional()
      .openapi({ description: 'The frozen column count in view' }),
  })
  .strict();

export class GridViewCore extends ViewCore {
  type!: ViewType.Grid;

  options!: IGridViewOptions;

  columnMeta!: IGridColumnMeta;
}
