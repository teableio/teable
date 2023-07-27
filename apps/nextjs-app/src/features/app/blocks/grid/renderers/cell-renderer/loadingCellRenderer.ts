import { drawRect } from '../base-renderer';
import type { ICellRenderProps, IInternalCellRenderer, ILoadingCell } from './interface';
import { CellType } from './interface';

export const loadingCellRenderer: IInternalCellRenderer<ILoadingCell> = {
  type: CellType.Loading,
  draw: (cell: ILoadingCell, props: ICellRenderProps) => {
    const { ctx, theme, rect } = props;
    const { x, y, width, height } = rect;
    const { cellBgLoading, cellHorizontalPadding, cellVerticalPadding } = theme;

    drawRect(ctx, {
      x: x + cellHorizontalPadding,
      y: y + cellVerticalPadding,
      width: width - 2 * cellHorizontalPadding,
      height: height - 2 * cellVerticalPadding,
      radius: 4,
      fill: cellBgLoading,
    });
  },
};
