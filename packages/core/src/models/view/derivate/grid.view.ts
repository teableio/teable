import type { ViewType, RowHeightLevel } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';

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
