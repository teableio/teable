import { GRID_DEFAULT } from '../../configs';
import { drawMultiLineText } from '../base-renderer/baseRenderer';
import { CellType } from './interface';
import type { IInternalCellRenderer, ITextCell, ICellRenderProps } from './interface';

// eslint-disable-next-line @typescript-eslint/naming-convention
const LINE_HEIGHT = 22;

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
    const { cellHorizontalPadding, cellVerticalPadding } = GRID_DEFAULT;
    const renderHeight = height - cellVerticalPadding;

    drawMultiLineText(ctx, {
      x: x + cellHorizontalPadding,
      y: y + cellVerticalPadding,
      text: displayData,
      maxLines: Math.floor(renderHeight / LINE_HEIGHT),
      lineHeight: LINE_HEIGHT,
      maxWidth: width - cellHorizontalPadding * 2,
      fill: cellTextColor,
      verticalAlign: 'top',
    });
  },
};
