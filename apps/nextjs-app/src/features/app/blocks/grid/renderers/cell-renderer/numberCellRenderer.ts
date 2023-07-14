import { GRID_DEFAULT } from '../../configs';
import { drawMultiLineText } from '../base-renderer/baseRenderer';
import { CellType } from './interface';
import type { IInternalCellRenderer, INumberCell, ICellRenderProps } from './interface';

export const numberCellRenderer: IInternalCellRenderer<INumberCell> = {
  type: CellType.Number,
  needsHover: false,
  needsHoverPosition: false,
  draw: (cell: INumberCell, props: ICellRenderProps) => {
    const { displayData } = cell;

    if (displayData == null || displayData === '') return;

    const { ctx, rect, theme } = props;
    const { x, y, width, height } = rect;
    const { cellPadding } = GRID_DEFAULT;
    const { cellTextColor } = theme;

    drawMultiLineText(ctx, {
      x: x + width - cellPadding,
      y: y + height / 2 + 1,
      text: displayData,
      maxLines: 1,
      maxWidth: width - cellPadding * 2,
      fill: cellTextColor,
      textAlign: 'right',
    });
  },
};
