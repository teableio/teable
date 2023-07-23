/* eslint-disable @typescript-eslint/naming-convention */
import type { IRectangle } from '../../interface';
import { drawRect, drawSingleLineText } from '../base-renderer/baseRenderer';
import { CellType } from './interface';
import type {
  IInternalCellRenderer,
  ICellRenderProps,
  ISelectCell,
  ISelectChoice,
} from './interface';

const OPTION_GAP_SIZE = 6;
const SELECT_CELL_PADDING_TOP = 6;

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
      iconSizeSM,
      cellHorizontalPadding,
      cellOptionBg,
      cellOptionTextColor,
    } = theme;

    const drawArea: IRectangle = {
      x: _x + cellHorizontalPadding,
      y: _y + SELECT_CELL_PADDING_TOP,
      width: width - 2 * cellHorizontalPadding,
      height: height - SELECT_CELL_PADDING_TOP,
    };
    const rows = Math.max(
      1,
      Math.floor((drawArea.height - iconSizeSM) / (iconSizeSM + OPTION_GAP_SIZE)) + 1
    );

    ctx.save();
    ctx.beginPath();

    if (value.length) {
      ctx.rect(_x, _y, width, height);
      ctx.clip();
    }

    ctx.font = `${fontSizeXS}px ${fontFamily}`;

    let x = drawArea.x;
    let row = 1;
    let y = drawArea.y;
    const choiceMap: Record<string, ISelectChoice> = {};
    choices?.forEach(({ id, name, bgColor, textColor }) => {
      choiceMap[id || name] = {
        id,
        name,
        bgColor,
        textColor,
      };
    });

    for (const text of value) {
      const metrics = ctx.measureText(text);
      const width = metrics.width + OPTION_GAP_SIZE * 2;
      const textY = iconSizeSM / 2 + 1;

      if (x !== drawArea.x && x + width > drawArea.x + drawArea.width && row < rows) {
        row++;
        y += iconSizeSM + OPTION_GAP_SIZE;
        x = drawArea.x;
      }
      const choice = choiceMap[text];
      const bgColor = choice?.bgColor || cellOptionBg;
      const textColor = choice?.textColor || cellOptionTextColor;

      drawRect(ctx, {
        x,
        y,
        width,
        height: iconSizeSM,
        radius: 8,
        fill: bgColor,
      });
      drawSingleLineText(ctx, {
        text,
        x: x + OPTION_GAP_SIZE,
        y: y + textY,
        fontSize: fontSizeXS,
        fill: textColor,
      });

      x += width + 8;
      if (x > drawArea.x + drawArea.width && row >= rows) break;
    }

    ctx.restore();
  },
};
