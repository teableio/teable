import { Colors, ColorUtils } from '@teable/core';
import { buttonClickTrigger } from '@teable/openapi';
import colors from 'tailwindcss/colors';

import type { IGridTheme } from '../../configs';
import { GRID_DEFAULT } from '../../configs';
import { inRange } from '../../utils';
import { drawRect, drawSingleLineText } from '../base-renderer';
import { CellRegionType, CellType } from './interface';
import type {
  IInternalCellRenderer,
  ICellRenderProps,
  ICellClickProps,
  ICellClickCallback,
  IButtonCell,
} from './interface';

const { cellVerticalPaddingSM } = GRID_DEFAULT;

const BUTTON_RADIUS = 4;
const BUTTON_WIDTH = 80;
const BUTTON_HEIGHT = 20;

const drawButton = (
  ctx: CanvasRenderingContext2D,
  props: {
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    maxTextWidth: number;
    textColor: string;
    bgColor: string;
    theme: IGridTheme;
    disabled?: boolean;
  }
) => {
  const { x, y, width, height, text, maxTextWidth, textColor, bgColor, theme, disabled } = props;
  const { fontSizeXS } = theme;

  drawRect(ctx, {
    x,
    y,
    width,
    height,
    radius: BUTTON_RADIUS,
    fill: disabled ? Colors.Gray : bgColor,
  });

  drawSingleLineText(ctx, {
    text,
    x: x + width / 2,
    y: y + (height - fontSizeXS) / 2 + 0.5,
    fill: textColor,
    maxWidth: maxTextWidth,
    fontSize: fontSizeXS,
    textAlign: 'center',
  });
};

const clickHandler = (cell: IButtonCell, props: ICellClickProps) => {
  const { id = '', data } = cell;

  console.log('clickHandler', cell, props);
  const { baseId, tableId, viewId } = data;
  const [fieldId = ''] = id.split('-');

  buttonClickTrigger(baseId, {
    tableId,
    viewId,
    fieldId,
  });
};

export const buttonCellRenderer: IInternalCellRenderer<IButtonCell> = {
  type: CellType.Button,
  needsHover: true,
  needsHoverPosition: true,
  draw: (cell: IButtonCell, props: ICellRenderProps) => {
    const { data } = cell;
    const { ctx, rect, theme } = props;
    const { x, y, width } = rect;
    const bgColor = ColorUtils.getHexForColor(data.color);
    const textColor = ColorUtils.shouldUseLightTextOnColor(data.color)
      ? colors.white
      : colors.black;

    return drawButton(ctx, {
      x: x + (width - BUTTON_WIDTH) / 2,
      y: y + cellVerticalPaddingSM,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      text: data.label,
      maxTextWidth: BUTTON_WIDTH,
      textColor,
      bgColor,
      theme,
      disabled: !data.workflowId,
    });
  },
  checkRegion: (cell: IButtonCell, props: ICellClickProps, _shouldCalculate?: boolean) => {
    const { data, readonly } = cell;
    if (readonly) return { type: CellRegionType.Blank };
    const { hoverCellPosition, width, height } = props;
    const [x, y] = hoverCellPosition;

    if (
      data.workflowId &&
      inRange(x, width / 2 - BUTTON_WIDTH / 2, width / 2 + BUTTON_WIDTH / 2) &&
      inRange(y, height / 2 - BUTTON_HEIGHT / 2, height / 2 + BUTTON_HEIGHT / 2)
    ) {
      return {
        type: CellRegionType.Update,
        data: null,
      };
    }
    return { type: CellRegionType.Blank };
  },
  onClick: (cell: IButtonCell, props: ICellClickProps, callback: ICellClickCallback) => {
    const cellRegion = buttonCellRenderer.checkRegion?.(cell, props, true);
    if (!cellRegion || cellRegion.type === CellRegionType.Blank) return;

    clickHandler(cell, props);
    callback(cellRegion);
  },
};
