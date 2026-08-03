import { GRID_DEFAULT } from '../../configs';
import { drawRect } from '../base-renderer';
import type { ICellRenderProps, IInternalCellRenderer, ILoadingCell } from './interface';
import { CellType } from './interface';

const { cellHorizontalPadding, cellVerticalPaddingXS } = GRID_DEFAULT;

export const loadingCellRenderer: IInternalCellRenderer<ILoadingCell> = {
  type: CellType.Loading,
  draw: (cell: ILoadingCell, props: ICellRenderProps) => {
    const { ctx, theme, rect } = props;
    const { x, y, width, height } = rect;
    const { cellBgLoading } = theme;

    drawRect(ctx, {
      x: x + cellHorizontalPadding,
      y: y + cellVerticalPaddingXS,
      width: width - 2 * cellHorizontalPadding,
      height: height - 2 * cellVerticalPaddingXS,
      radius: 4,
      fill: cellBgLoading,
    });
  },
};
