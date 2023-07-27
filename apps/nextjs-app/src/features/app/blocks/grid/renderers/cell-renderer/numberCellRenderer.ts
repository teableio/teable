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
    const { x, y, width } = rect;
    const { cellHorizontalPadding, cellVerticalPadding } = GRID_DEFAULT;
    const { cellTextColor } = theme;

    drawMultiLineText(ctx, {
      x: x + width - cellHorizontalPadding,
      y: y + cellVerticalPadding,
      text: displayData,
      maxLines: 1,
      maxWidth: width - cellHorizontalPadding * 2,
      fill: cellTextColor,
      textAlign: 'right',
      verticalAlign: 'top',
    });
  },
};
