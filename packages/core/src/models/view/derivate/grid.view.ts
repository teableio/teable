import type { ViewType, RowHeightLevel } from '../constant';
import type { IViewVo } from '../interface';
import { ViewCore } from '../view';

export interface IGridView extends IViewVo {
  type: ViewType.Grid;
  options: GridViewOptions;
}

export class GridViewOptions {
  rowHeight?: RowHeightLevel;
}

export class GridViewCore extends ViewCore {
  type!: ViewType.Grid;

  options!: GridViewOptions;
}
