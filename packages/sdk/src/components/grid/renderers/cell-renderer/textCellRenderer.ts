import { GRID_DEFAULT } from '../../configs';
import { drawMultiLineText } from '../base-renderer/baseRenderer';
import { CellType } from './interface';
import type { IInternalCellRenderer, ITextCell, ICellRenderProps } from './interface';

const { cellHorizontalPadding, cellVerticalPadding, cellTextLineHeight } = GRID_DEFAULT;

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
    const renderHeight = height - cellVerticalPadding;

    drawMultiLineText(ctx, {
      x: x + cellHorizontalPadding,
      y: y + cellVerticalPadding,
      text: displayData,
      maxLines: Math.floor(renderHeight / cellTextLineHeight),
      lineHeight: cellTextLineHeight,
      maxWidth: width - cellHorizontalPadding * 2,
      fill: cellTextColor,
    });
  },
};
