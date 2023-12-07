import { GRID_DEFAULT } from '../../configs';
import { drawMultiLineText, drawProcessBar, drawRing } from '../base-renderer/baseRenderer';
import { CellType, NumberDisplayType } from './interface';
import type {
  INumberCell,
  ICellRenderProps,
  ICellMeasureProps,
  IInternalCellRenderer,
} from './interface';

const { maxRowCount, cellVerticalPadding, cellTextLineHeight } = GRID_DEFAULT;

export const numberCellRenderer: IInternalCellRenderer<INumberCell> = {
  type: CellType.Number,
  measure: (cell: INumberCell, props: ICellMeasureProps) => {
    const { displayData, showAs } = cell;
    const { width, height } = props;

    if (!displayData || typeof displayData === 'string' || showAs != null) {
      return { width, height, totalHeight: height };
    }

    const lineCount = displayData.length;
    const totalHeight = cellVerticalPadding + lineCount * cellTextLineHeight;
    const displayRowCount = Math.min(maxRowCount, lineCount);

    return {
      width,
      height: Math.max(height, cellVerticalPadding + displayRowCount * cellTextLineHeight),
      totalHeight,
    };
  },
  draw: (cell: INumberCell, props: ICellRenderProps) => {
    const { data, displayData, showAs } = cell;

    if (data == null || displayData == null || displayData === '') return;

    const { ctx, rect, theme, isActive } = props;
    const { x, y, width } = rect;
    const { cellHorizontalPadding, cellVerticalPadding } = GRID_DEFAULT;
    const { cellTextColor } = theme;
    let textX = x + width - cellHorizontalPadding;
    let textMaxWidth = width - cellHorizontalPadding * 2;
    const showText = showAs?.showValue ?? true;

    if (showAs != null) {
      const { type, color, maxValue } = showAs;

      if (type === NumberDisplayType.Ring) {
        const radius = 8.5;
        drawRing(ctx, {
          x: x + width - cellHorizontalPadding - radius,
          y: y + cellVerticalPadding + radius - 3,
          value: data,
          maxValue,
          color,
          radius,
          lineWidth: 5,
        });

        textX = textX - 3 * radius;
        textMaxWidth = textX - 3 * radius;
      }

      if (type === NumberDisplayType.Bar) {
        const height = 8;
        const halfWidth = width / 2;
        drawProcessBar(ctx, {
          x: x + halfWidth,
          y: y + cellVerticalPadding + 2,
          width: halfWidth - cellHorizontalPadding,
          height,
          value: data,
          maxValue,
          color,
        });

        textX = x + halfWidth - cellHorizontalPadding;
        textMaxWidth = halfWidth - cellHorizontalPadding;
      }
    }

    if (!showText) return;

    if (typeof displayData === 'string') {
      return drawMultiLineText(ctx, {
        x: textX,
        y: y + cellVerticalPadding,
        text: displayData,
        maxLines: 1,
        maxWidth: textMaxWidth,
        fill: cellTextColor,
        textAlign: 'right',
      });
    }
    let curY = y + cellVerticalPadding;
    if (!isActive) {
      return drawMultiLineText(ctx, {
        x: textX,
        y: y + cellVerticalPadding,
        text: displayData.join(', '),
        maxLines: 1,
        maxWidth: textMaxWidth,
        fill: cellTextColor,
        textAlign: 'right',
      });
    }
    displayData.forEach((text, index) => {
      const isLast = index === displayData.length - 1;
      drawMultiLineText(ctx, {
        x: textX,
        y: curY,
        text: isLast ? text : `${text},`,
        maxLines: 1,
        maxWidth: textMaxWidth,
        fill: cellTextColor,
        textAlign: 'right',
      });
      curY += cellTextLineHeight;
    });
  },
};
