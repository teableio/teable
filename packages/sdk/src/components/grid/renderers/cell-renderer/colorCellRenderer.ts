import { GRID_DEFAULT } from '../../configs';
import { drawRect, drawSingleLineText } from '../base-renderer';
import type { ICellRenderProps, IColorCell, IInternalCellRenderer } from './interface';
import { CellType } from './interface';

const { cellHorizontalPadding, rowHeight } = GRID_DEFAULT;

const SWATCH_SIZE = 22;
const SWATCH_RADIUS = 11;
const SWATCH_GAP = 6;

const INNER_CIRCLE_SIZE = 14;
const INNER_CIRCLE_RADIUS = 7;

export const colorCellRenderer: IInternalCellRenderer<IColorCell> = {
  type: CellType.Color,

  draw(cell: IColorCell, props: ICellRenderProps) {
    const { ctx, rect, theme } = props;
    const { x, y, width, height } = rect;
    const { data, displayData } = cell;
    const { cellTextColor, fontSizeXS, fontFamily, cellBg } = theme;

    if (!data) return;

    const swatchX = x + cellHorizontalPadding - 1;
    const swatchY = y + (height - SWATCH_SIZE + 1) / 2;

    // Draw color swatch
    ctx.save();

    drawRect(ctx, {
      x: swatchX,
      y: swatchY,
      width: SWATCH_SIZE,
      height: SWATCH_SIZE,
      radius: SWATCH_RADIUS,
      fill: data,
    });

    const circleX = swatchX + 4;
    const circleY = swatchY + 4;

    ctx.lineWidth = 2;
    drawRect(ctx, {
      x: circleX,
      y: circleY,
      width: INNER_CIRCLE_SIZE,
      height: INNER_CIRCLE_SIZE,
      radius: INNER_CIRCLE_RADIUS,
      stroke: cellBg,
    });

    // Draw hex text next to swatch
    ctx.font = `${fontSizeXS}px ${fontFamily}`;
    const textX = swatchX + SWATCH_SIZE + SWATCH_GAP + 2;
    drawSingleLineText(ctx, {
      x: textX,
      y: y + (rowHeight - fontSizeXS) / 2,
      text: displayData,
      fill: cellTextColor,
      maxWidth: width - (textX - x) - cellHorizontalPadding,
    });

    ctx.restore();
  },
};
