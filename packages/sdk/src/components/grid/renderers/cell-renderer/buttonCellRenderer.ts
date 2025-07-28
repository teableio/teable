import { Colors, ColorUtils } from '@teable/core';
import { workflowTriggerFire } from '@teable/openapi';
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

const { cellVerticalPaddingSM, cellHorizontalPadding } = GRID_DEFAULT;

const BUTTON_RADIUS = 4;
const BUTTON_WIDTH = 80;
const BUTTON_HEIGHT = 20;

const clickHandler = async (cell: IButtonCell) => {
  const { id = '', data } = cell;

  const { baseId, tableId } = data;
  const [recordId = '', fieldId = ''] = id.split('-');

  await workflowTriggerFire(baseId, 'buttonClick', {
    tableId,
    fieldId,
    recordId,
  });
};

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
  }
) => {
  const { x, y, width, height, text, maxTextWidth, textColor, bgColor, theme } = props;
  const { fontSizeXS } = theme;

  drawRect(ctx, {
    x,
    y,
    width,
    height,
    radius: BUTTON_RADIUS,
    fill: bgColor,
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

export const buttonCellRenderer: IInternalCellRenderer<IButtonCell> = {
  type: CellType.Button,
  needsHover: true,
  needsHoverPosition: true,
  draw: (cell: IButtonCell, props: ICellRenderProps) => {
    const { data, readonly } = cell;
    const { fieldOptions } = data;
    const { ctx, rect, theme } = props;
    const { x, y, width } = rect;
    const rectColor = readonly ? Colors.Gray : fieldOptions.color;
    const bgColor = ColorUtils.getHexForColor(rectColor);
    const textColor = ColorUtils.shouldUseLightTextOnColor(rectColor) ? colors.white : colors.black;

    return drawButton(ctx, {
      x: x + (width - BUTTON_WIDTH) / 2,
      y: y + cellVerticalPaddingSM,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      text: fieldOptions.label,
      maxTextWidth: BUTTON_WIDTH - 2 * cellHorizontalPadding,
      textColor,
      bgColor,
      theme,
    });
  },
  checkRegion: (cell: IButtonCell, props: ICellClickProps, _shouldCalculate?: boolean) => {
    const { readonly, data } = cell;
    const { cellValue } = data;
    if (readonly) return { type: CellRegionType.Blank };
    const { hoverCellPosition, width, height } = props;
    const [x, y] = hoverCellPosition;

    if (
      inRange(x, width / 2 - BUTTON_WIDTH / 2, width / 2 + BUTTON_WIDTH / 2) &&
      inRange(y, height / 2 - BUTTON_HEIGHT / 2, height / 2 + BUTTON_HEIGHT / 2)
    ) {
      return {
        type: CellRegionType.Update,
        data: {
          count: (cellValue?.count || 0) + 1,
        },
      };
    }
    return { type: CellRegionType.Blank };
  },
  onClick: (cell: IButtonCell, props: ICellClickProps, _callback: ICellClickCallback) => {
    const cellRegion = buttonCellRenderer.checkRegion?.(cell, props, true);
    if (!cellRegion || cellRegion.type === CellRegionType.Blank) return;

    clickHandler(cell);
    // callback(cellRegion);
  },
};
