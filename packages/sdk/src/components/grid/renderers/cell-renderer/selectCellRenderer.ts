import type { IRectangle } from '../../interface';
import { drawRect, drawSingleLineText } from '../base-renderer/baseRenderer';
import { CellType } from './interface';
import type {
  IInternalCellRenderer,
  ICellRenderProps,
  ISelectCell,
  ISelectChoice,
} from './interface';

const OPTION_RADIUS = 6;
const OPTION_GAP_SIZE = 6;
const OPTION_PADDING_HORIZONTAL = 8;
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
    const maxTextWidth = drawArea.width - OPTION_GAP_SIZE * 2;

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
      const choice = choiceMap[text];
      const bgColor = choice?.bgColor || cellOptionBg;
      const textColor = choice?.textColor || cellOptionTextColor;

      const { width: displayWidth, text: displayText } = drawSingleLineText(ctx, {
        text,
        fill: textColor,
        maxWidth: maxTextWidth,
        needRender: false,
        fontSize: fontSizeXS,
      });

      const width = displayWidth + OPTION_PADDING_HORIZONTAL * 2;

      if (x !== drawArea.x && x + width > drawArea.x + drawArea.width && row < rows) {
        row++;
        y += iconSizeSM + OPTION_GAP_SIZE;
        x = drawArea.x;
      }

      drawRect(ctx, {
        x,
        y,
        width,
        height: iconSizeSM,
        radius: OPTION_RADIUS,
        fill: bgColor,
      });
      drawSingleLineText(ctx, {
        text: displayText,
        x: x + OPTION_PADDING_HORIZONTAL,
        y: y + 4,
        fill: textColor,
        maxWidth: maxTextWidth,
      });

      x += width + 8;
      if (x > drawArea.x + drawArea.width && row >= rows) break;
    }

    ctx.restore();
  },
};
