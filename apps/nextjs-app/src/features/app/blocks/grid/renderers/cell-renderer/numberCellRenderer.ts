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
    const { ctx, x, y, width, height, theme } = props;
    if (displayData == null || displayData === '') return;

    const { columnHeaderNameColor, fontSizeMD } = theme;
    const { cellPadding } = GRID_DEFAULT;

    drawMultiLineText(ctx, {
      x: x + width - cellPadding,
      y: y + height / 2 + 1,
      text: displayData,
      maxLines: 1,
      maxWidth: width - cellPadding * 2,
      fill: columnHeaderNameColor,
      fontSize: fontSizeMD,
      textAlign: 'right',
    });
  },
};
