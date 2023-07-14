/* eslint-disable @typescript-eslint/naming-convention */
import type { IRectangle } from '../../interface';
import { drawRect, drawSingleLineText } from '../base-renderer/baseRenderer';
import { CellType } from './interface';
import type { IInternalCellRenderer, ICellRenderProps, ISelectCell } from './interface';

const OPTION_HEIGHT = 20;
const OPTION_INNER_PADDING = 6;

export const selectCellRenderer: IInternalCellRenderer<ISelectCell> = {
  type: CellType.Select,
  needsHover: false,
  needsHoverPosition: false,
  draw: (cell: ISelectCell, props: ICellRenderProps) => {
    const { ctx, rect, theme } = props;
    const { data: value, choices } = cell;
    const { x: _x, y: _y, width, height } = rect;
    const {
      fontSizeXS,
      fontFamily,
      cellTextColor,
      cellHorizontalPadding,
      cellVerticalPadding,
      cellOptionBgDefault,
    } = theme;

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

    ctx.font = `${fontSizeXS}px ${fontFamily}`;

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
      const choice = choices?.find(({ name }) => name === text);
      const bgColor = choice?.bgColor || cellOptionBgDefault;
      const textColor = choice?.textColor || cellTextColor;

      drawRect(ctx, {
        x,
        y,
        width,
        height: OPTION_HEIGHT,
        radius: 8,
        fill: bgColor,
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
