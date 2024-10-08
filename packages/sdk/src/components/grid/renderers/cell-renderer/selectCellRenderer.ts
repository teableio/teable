import { LRUCache } from 'lru-cache';
import type { IGridTheme } from '../../configs';
import { GRID_DEFAULT } from '../../configs';
import type { IRectangle } from '../../interface';
import type { SpriteManager } from '../../managers';
import { GridInnerIcon } from '../../managers';
import { isPointInsideRectangle } from '../../utils';
import { drawRect, drawSingleLineText } from '../base-renderer/baseRenderer';
import { CellRegionType, CellType } from './interface';
import type {
  IInternalCellRenderer,
  ICellRenderProps,
  ISelectCell,
  ICellMeasureProps,
  ICellClickProps,
  ICellClickCallback,
} from './interface';

enum ISelectRegionType {
  Content = 'Content',
  DeleteBtn = 'DeleteBtn',
}

interface ISelectRegion extends IRectangle {
  type: ISelectRegionType;
}

const positionCache: LRUCache<string, ISelectRegion[]> = new LRUCache({
  max: 10,
});

const OPTION_RADIUS = 6;
const OPTION_GAP_SIZE = 6;
const OPTION_PADDING_HORIZONTAL = 8;
const SELECT_CELL_PADDING_TOP = 6;

const { cellHorizontalPadding, maxRowCount } = GRID_DEFAULT;

const drawLabel = (
  ctx: CanvasRenderingContext2D,
  props: {
    x: number;
    y: number;
    width: number;
    text: string;
    maxTextWidth: number;
    textColor: string;
    bgColor: string;
    editable?: boolean;
    theme: IGridTheme;
    spriteManager: SpriteManager;
  }
) => {
  const { x, y, width, text, maxTextWidth, textColor, bgColor, editable, theme, spriteManager } =
    props;
  const { fontSizeXS, iconSizeSM, iconSizeXS } = theme;

  drawRect(ctx, {
    x,
    y,
    width,
    height: iconSizeSM,
    radius: OPTION_RADIUS,
    fill: bgColor,
  });
  drawSingleLineText(ctx, {
    text,
    x: x + OPTION_PADDING_HORIZONTAL,
    y: y + (iconSizeSM - fontSizeXS) / 2 + 0.5,
    fill: textColor,
    maxWidth: maxTextWidth,
    fontSize: fontSizeXS,
  });

  if (editable) {
    spriteManager.drawSprite(ctx, {
      sprite: GridInnerIcon.Close,
      x: x + width - iconSizeXS - OPTION_PADDING_HORIZONTAL + 2,
      y: y + 2,
      size: iconSizeXS,
      theme,
      colors: [textColor, textColor],
    });
  }
};

export const selectCellRenderer: IInternalCellRenderer<ISelectCell> = {
  type: CellType.Select,
  needsHoverPositionWhenActive: true,
  measure: (cell: ISelectCell, props: ICellMeasureProps) => {
    const { displayData, readonly } = cell;
    const { ctx, theme, width, height } = props;
    const { cellTextColor, fontSizeXS, iconSizeSM, iconSizeXS } = theme;

    if (!displayData.length) return { width, height, totalHeight: height };

    const drawArea: IRectangle = {
      x: cellHorizontalPadding,
      y: SELECT_CELL_PADDING_TOP,
      width: width - 2 * cellHorizontalPadding,
      height: height - SELECT_CELL_PADDING_TOP,
    };

    let lineCount = 1;
    let x = drawArea.x;
    let y = drawArea.y;
    const deleteBtnWidth = !readonly ? iconSizeXS : 0;
    const maxTextWidth = drawArea.width - OPTION_GAP_SIZE * 2 - deleteBtnWidth;
    const totalOptionPadding = OPTION_PADDING_HORIZONTAL * 2 + deleteBtnWidth;
    const rightEdgeOfDrawArea = drawArea.x + drawArea.width;
    const lineHeight = iconSizeSM + OPTION_GAP_SIZE;

    const cacheKey = `${String(width)}-${displayData.join(',')}`;
    const positions: ISelectRegion[] = [];

    for (const text of displayData) {
      const { width: displayWidth } = drawSingleLineText(ctx, {
        text,
        fill: cellTextColor,
        maxWidth: maxTextWidth,
        needRender: false,
        fontSize: fontSizeXS,
      });

      const width = displayWidth + totalOptionPadding;

      if (x !== drawArea.x && x + width > rightEdgeOfDrawArea) {
        lineCount++;
        x = drawArea.x;
        y += lineHeight;
      }

      positions.push({
        type: ISelectRegionType.Content,
        x,
        y: y + 2,
        width: displayWidth + OPTION_PADDING_HORIZONTAL + 2,
        height: lineHeight,
      });

      if (!readonly) {
        positions.push({
          type: ISelectRegionType.DeleteBtn,
          x: x + width - iconSizeXS - OPTION_PADDING_HORIZONTAL + 2,
          y: y + 2,
          width: iconSizeXS,
          height: lineHeight,
        });
      }

      x += width + OPTION_PADDING_HORIZONTAL;
    }

    positionCache.set(cacheKey, positions);

    const totalHeight = SELECT_CELL_PADDING_TOP + lineCount * lineHeight;
    const displayRowCount = Math.min(maxRowCount, lineCount);

    return {
      width,
      height: Math.max(height, SELECT_CELL_PADDING_TOP + displayRowCount * lineHeight),
      totalHeight,
    };
  },
  draw: (cell: ISelectCell, props: ICellRenderProps) => {
    const { ctx, rect, theme, isActive, spriteManager } = props;
    const { displayData, choiceMap, readonly } = cell;
    const { x: _x, y: _y, width, height } = rect;
    const clipEnable = !isActive && displayData.length;
    const { fontSizeXS, fontFamily, iconSizeXS, iconSizeSM, cellOptionBg, cellOptionTextColor } =
      theme;

    const drawArea: IRectangle = {
      x: _x + cellHorizontalPadding,
      y: _y + SELECT_CELL_PADDING_TOP,
      width: width - 2 * cellHorizontalPadding,
      height: height - SELECT_CELL_PADDING_TOP,
    };
    const combinedHeight = iconSizeSM + OPTION_GAP_SIZE;
    const rows = isActive
      ? Infinity
      : Math.max(1, Math.floor((drawArea.height - iconSizeSM) / combinedHeight) + 1);
    const editable = !readonly && isActive;
    const deleteBtnWidth = editable ? iconSizeXS : 0;
    const maxTextWidth = drawArea.width - OPTION_GAP_SIZE * 2 - deleteBtnWidth;
    const totalOptionPadding = OPTION_PADDING_HORIZONTAL * 2 + deleteBtnWidth;
    const rightEdgeOfDrawArea = drawArea.x + drawArea.width;

    let row = 1;
    let x = drawArea.x;
    let y = drawArea.y;

    ctx.save();
    ctx.beginPath();

    if (clipEnable) {
      ctx.rect(_x, _y, width, height);
      ctx.clip();
    }

    ctx.font = `${fontSizeXS}px ${fontFamily}`;

    for (const text of displayData) {
      const choice = choiceMap?.[text];
      const bgColor = choice?.backgroundColor || cellOptionBg;
      const textColor = choice?.color || cellOptionTextColor;

      const { width: displayWidth, text: displayText } = drawSingleLineText(ctx, {
        text,
        fill: textColor,
        maxWidth: maxTextWidth,
        fontSize: fontSizeXS,
        needRender: false,
      });

      const width = Math.min(displayWidth + totalOptionPadding, drawArea.width);

      if (x !== drawArea.x && x + width > rightEdgeOfDrawArea && row < rows) {
        row++;
        y += combinedHeight;
        x = drawArea.x;
      }

      drawLabel(ctx, {
        x,
        y,
        width,
        text: displayText,
        maxTextWidth,
        textColor,
        bgColor,
        editable,
        theme,
        spriteManager,
      });

      x += width + OPTION_PADDING_HORIZONTAL;
      if (x > rightEdgeOfDrawArea && row >= rows) break;
    }

    ctx.restore();
  },
  // eslint-disable-next-line sonarjs/cognitive-complexity
  checkRegion: (cell: ISelectCell, props: ICellClickProps, shouldCalculate?: boolean) => {
    const { data, displayData, readonly } = cell;
    const { width, isActive, hoverCellPosition, activeCellBound } = props;
    const editable = !readonly && isActive && activeCellBound;
    if (!editable) return { type: CellRegionType.Blank };

    const { scrollTop } = activeCellBound;
    const [hoverX, hoverY] = hoverCellPosition;

    const cacheKey = `${String(width)}-${displayData.join(',')}`;
    const positions = positionCache.get(cacheKey);

    if (!positions) return { type: CellRegionType.Blank };

    for (let i = 0; i < positions.length; i++) {
      const { type, x, y, width, height } = positions[i];

      if (isPointInsideRectangle([hoverX, scrollTop + hoverY], [x, y], [x + width, y + height])) {
        if (!shouldCalculate) {
          return {
            type:
              type === ISelectRegionType.DeleteBtn ? CellRegionType.Update : CellRegionType.Preview,
            data: null,
          };
        }

        const realIndex = Math.floor(i / 2);

        if (type === ISelectRegionType.DeleteBtn) {
          const result = data.filter((_, index) => index !== realIndex);
          return {
            type: CellRegionType.Update,
            data: result.length ? result : null,
          };
        }
        return {
          type: CellRegionType.Preview,
          data: (data[realIndex] as { id: string; title: string })?.id,
        };
      }
    }

    return { type: CellRegionType.Blank };
  },
  onClick: (cell: ISelectCell, props: ICellClickProps, callback: ICellClickCallback) => {
    const { readonly, isEditingOnClick } = cell;
    const { isActive } = props;
    const cellRegion = selectCellRenderer.checkRegion?.(cell, props, true);
    if (!cellRegion) return;
    if (cellRegion.type === CellRegionType.Blank) {
      const editable = !readonly && isActive;
      if (editable && isEditingOnClick) {
        return callback({ type: CellRegionType.ToggleEditing, data: null });
      }
      return;
    }
    if (cellRegion.type === CellRegionType.Preview) {
      return cell?.onPreview?.(cellRegion.data as string);
    }
    callback(cellRegion);
  },
};
