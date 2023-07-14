import { GRID_DEFAULT } from '../../configs';
import { drawMultiLineText } from '../base-renderer/baseRenderer';
import { CellType } from './interface';
import type { IInternalCellRenderer, ITextCell, ICellRenderProps } from './interface';

export const textCellRenderer: IInternalCellRenderer<ITextCell> = {
  type: CellType.Text,
  needsHover: false,
  needsHoverPosition: false,
  draw: (cell: ITextCell, props: ICellRenderProps) => {
    const { displayData } = cell;
    const { ctx, rect, theme } = props;
    const { x, y, width, height } = rect;
    if (displayData == null || displayData === '') return;

    const { cellTextColor } = theme;
    const { cellPadding } = GRID_DEFAULT;

    drawMultiLineText(ctx, {
      x: x + cellPadding,
      y: y + height / 2 + 1,
      text: displayData,
      maxLines: 1,
      maxWidth: width - cellPadding * 2,
      fill: cellTextColor,
    });
  },
};
