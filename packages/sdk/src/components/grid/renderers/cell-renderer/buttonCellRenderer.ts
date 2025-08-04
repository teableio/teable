import { Colors, ColorUtils } from '@teable/core';
import { buttonClick } from '@teable/openapi';
import { LRUCache } from 'lru-cache';
import colors from 'tailwindcss/colors';

import type { IGridTheme } from '../../configs';
import { GRID_DEFAULT } from '../../configs';
import type { IRectangle } from '../../interface';
import { inRange } from '../../utils';
import { drawRect, drawSingleLineText } from '../base-renderer';
import { CellRegionType, CellType } from './interface';
import type {
  IInternalCellRenderer,
  ICellRenderProps,
  ICellClickProps,
  ICellClickCallback,
  IButtonCell,
  ICellMeasureProps,
} from './interface';

const { cellVerticalPaddingSM, cellHorizontalPadding } = GRID_DEFAULT;

const BUTTON_RADIUS = 4;
const BUTTON_HEIGHT = 20;
const BUTTON_MIN_WIDTH = 60;
const BUTTON_MAX_WIDTH = 80;

const positionCache: LRUCache<string, IRectangle> = new LRUCache({
  max: 10,
});

const clickHandler = (cell: IButtonCell) => {
  const { id = '', data, readonly } = cell;
  if (readonly) return;

  const { tableId } = data;
  const [recordId = '', fieldId = ''] = id.split('-');
  buttonClick(tableId, recordId, fieldId);
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
  const { fontSizeXS, fontFamily } = theme;

  ctx.save();
  ctx.font = `${fontSizeXS}px ${fontFamily}`;

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

  ctx.restore();
};

const calcPosition = (
  cell: IButtonCell,
  props: { width: number; ctx: CanvasRenderingContext2D; theme: IGridTheme },
  flush = false
) => {
  const { data } = cell;
  const { fieldOptions } = data;
  const { width, ctx, theme } = props;
  const { fontSizeXS, fontFamily } = theme;
  const cacheKey = `${fieldOptions.label}-${width}`;
  if (!flush) {
    const cachedRect = positionCache.get(cacheKey);
    if (cachedRect) return cachedRect;
  }

  ctx.save();
  ctx.font = `${fontSizeXS}px ${fontFamily}`;
  const { width: textWidth } = drawSingleLineText(ctx, {
    text: fieldOptions.label,
    maxWidth: BUTTON_MAX_WIDTH - 2 * cellHorizontalPadding,
    fontSize: fontSizeXS,
    needRender: false,
  });
  ctx.restore();

  const finnalTextWidth = Math.max(textWidth, BUTTON_MIN_WIDTH - 2 * cellHorizontalPadding);
  const rectWidth = finnalTextWidth + 2 * cellHorizontalPadding;

  const position: IRectangle = {
    x: (width - rectWidth) / 2,
    y: cellVerticalPaddingSM,
    width: rectWidth,
    height: BUTTON_HEIGHT,
  };
  positionCache.set(cacheKey, position);
  return position;
};

export const buttonCellRenderer: IInternalCellRenderer<IButtonCell> = {
  type: CellType.Button,
  needsHover: true,
  needsHoverPosition: true,
  needsHoverWhenActive: true,
  needsHoverPositionWhenActive: true,
  measure: (cell: IButtonCell, props: ICellMeasureProps) => {
    const { width, height, ctx, theme } = props;
    const position = calcPosition(
      cell,
      {
        width,
        ctx,
        theme,
      },
      true
    );
    return {
      width,
      height: Math.max(height, position.height),
      totalHeight: position.height,
    };
  },
  draw: (cell: IButtonCell, props: ICellRenderProps) => {
    const { data, readonly } = cell;
    const { fieldOptions } = data;
    const { ctx, rect, theme } = props;
    const { x, y, width } = rect;
    const rectColor = readonly ? Colors.Gray : fieldOptions.color;
    const bgColor = ColorUtils.getHexForColor(rectColor);
    const textColor = ColorUtils.shouldUseLightTextOnColor(rectColor) ? colors.white : colors.black;

    const position = calcPosition(cell, {
      width,
      ctx,
      theme,
    });

    return drawButton(ctx, {
      x: x + position.x,
      y: y + position.y,
      width: position.width,
      height: position.height,
      text: fieldOptions.label,
      maxTextWidth: position.width - 2 * cellHorizontalPadding,
      textColor,
      bgColor,
      theme,
    });
  },
  checkRegion: (cell: IButtonCell, props: ICellClickProps, _shouldCalculate?: boolean) => {
    const { data } = cell;
    const { fieldOptions } = data;
    const { hoverCellPosition, width } = props;
    const [x, y] = hoverCellPosition;

    const cacheKey = `${fieldOptions.label}-${width}`;
    const rect = positionCache.get(cacheKey);
    if (
      rect &&
      inRange(x, rect.x, rect.x + rect.width) &&
      inRange(y, rect.y, rect.y + rect.height)
    ) {
      return {
        type: CellRegionType.Hover,
        data: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
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
