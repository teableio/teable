/* eslint-disable @typescript-eslint/naming-convention */
import { ColorUtils } from '@teable-group/core';
import type { IRectangle } from '../../interface';
import { drawRect, drawSingleLineText } from '../base-renderer/baseRenderer';
import { CellType } from './interface';
import type { IInternalCellRenderer, ICellRenderProps, ISelectCell } from './interface';

const OPTION_HEIGHT = 20;
const OPTION_INNER_PADDING = 6;
const defaultOptionBg = '#EDEDF3';

export const selectCellRenderer: IInternalCellRenderer<ISelectCell> = {
  type: CellType.Select,
  needsHover: false,
  needsHoverPosition: false,
  draw: (cell: ISelectCell, props: ICellRenderProps) => {
    const { ctx, x: _x, y: _y, width, height, theme } = props;
    const {
      fontSizeSM,
      fontFamily,
      cellTextColor,
      staticBlack,
      staticWhite,
      cellHorizontalPadding,
      cellVerticalPadding,
    } = theme;
    const { value, options } = cell.data;

    const drawArea: IRectangle = {
      x: _x + cellHorizontalPadding,
      y: _y + cellVerticalPadding,
      width: width - 2 * cellHorizontalPadding,
      height: height - 2 * cellVerticalPadding,
    };
    const rows = Math.max(1, Math.floor(drawArea.height / (OPTION_HEIGHT + OPTION_INNER_PADDING)));

    ctx.save();
    ctx.beginPath();

    if (value.length) {
      ctx.rect(_x, _y, width, height);
      ctx.clip();
    }

    ctx.font = `${fontSizeSM}px ${fontFamily}`;

    let x = drawArea.x;
    let row = 1;
    let y =
      drawArea.y + (drawArea.height - rows * OPTION_HEIGHT - (rows - 1) * OPTION_INNER_PADDING) / 2;

    for (const text of value) {
      const metrics = ctx.measureText(text);
      const width = metrics.width + OPTION_INNER_PADDING * 2;
      const textY = OPTION_HEIGHT / 2;

      if (x !== drawArea.x && x + width > drawArea.x + drawArea.width && row < rows) {
        row++;
        y += OPTION_HEIGHT + OPTION_INNER_PADDING;
        x = drawArea.x;
      }
      const color = options?.choices.find((choice) => choice.name === text)?.color;
      const optionBg = color ? ColorUtils.getHexForColor(color) : defaultOptionBg;
      const textColor = color
        ? ColorUtils.shouldUseLightTextOnColor(color)
          ? staticWhite
          : staticBlack
        : cellTextColor;

      drawRect(ctx, {
        x,
        y,
        width,
        height: OPTION_HEIGHT,
        radius: OPTION_HEIGHT / 2,
        fill: optionBg,
      });
      drawSingleLineText(ctx, {
        text,
        x: x + OPTION_INNER_PADDING,
        y: y + textY,
        fontSize: 12,
        fill: textColor,
      });

      x += width + 8;
      if (x > drawArea.x + drawArea.width && row >= rows) break;
    }

    ctx.restore();
  },
};
