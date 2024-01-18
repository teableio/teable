import { GRID_DEFAULT } from '../../configs';
import { drawMultiLineText } from '../base-renderer/baseRenderer';
import { CellType } from './interface';
import type {
  IInternalCellRenderer,
  ITextCell,
  ICellRenderProps,
  ICellMeasureProps,
} from './interface';

const { maxRowCount, cellHorizontalPadding, cellVerticalPaddingMD, cellTextLineHeight } =
  GRID_DEFAULT;

export const textCellRenderer: IInternalCellRenderer<ITextCell> = {
  type: CellType.Text,
  measure: (cell: ITextCell, props: ICellMeasureProps) => {
    const { displayData } = cell;
    const { ctx, theme, width, height } = props;
    const { cellTextColor } = theme;

    if (!displayData) {
      return { width, height, totalHeight: height };
    }

    const lineCount = drawMultiLineText(ctx, {
      text: displayData,
      maxLines: Infinity,
      lineHeight: cellTextLineHeight,
      maxWidth: width - cellHorizontalPadding * 2,
      fill: cellTextColor,
      needRender: false,
    }).length;

    const totalHeight = cellVerticalPaddingMD + lineCount * cellTextLineHeight;
    const displayRowCount = Math.min(maxRowCount, lineCount);

    return {
      width,
      height: Math.max(height, cellVerticalPaddingMD + displayRowCount * cellTextLineHeight),
      totalHeight,
    };
  },
  draw: (cell: ITextCell, props: ICellRenderProps) => {
    const { displayData } = cell;
    const { ctx, rect, theme, isActive } = props;
    const { x, y, width, height } = rect;

    if (!displayData) return;

    const { cellTextColor } = theme;
    const renderHeight = height - cellVerticalPaddingMD;

    drawMultiLineText(ctx, {
      x: x + cellHorizontalPadding,
      y: y + cellVerticalPaddingMD,
      text: displayData,
      maxLines: isActive ? Infinity : Math.max(Math.floor(renderHeight / cellTextLineHeight), 1),
      lineHeight: cellTextLineHeight,
      maxWidth: width - cellHorizontalPadding * 2,
      fill: cellTextColor,
    });
  },
};
