import z from 'zod';
import type { IGridColumnMeta } from '../column-meta.schema';
import { RowHeightLevel } from '../constant';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';

export interface IGridView extends IViewVo {
  type: ViewType.Grid;
  options: GridViewOptions;
}

export class GridViewOptions {
  rowHeight?: RowHeightLevel;
  frozenColumnCount?: number;
}

export const gridViewOptionSchema = z
  .object({
    rowHeight: z.nativeEnum(RowHeightLevel).optional(),
    frozenColumnCount: z.number().optional(),
  })
  .strict();

export class GridViewCore extends ViewCore {
  type!: ViewType.Grid;

  options!: GridViewOptions;

  columnMeta!: IGridColumnMeta;
}
