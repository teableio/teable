import type { IGridColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';
import type { IGridViewOptions } from './grid-view-option.schema';

export interface IGridView extends IViewVo {
  type: ViewType.Grid;
  options: IGridViewOptions;
}

export class GridViewCore extends ViewCore {
  type!: ViewType.Grid;

  options!: IGridViewOptions;

  columnMeta!: IGridColumnMeta;
}
