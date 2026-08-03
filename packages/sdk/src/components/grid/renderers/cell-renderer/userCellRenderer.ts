import { LRUCache } from 'lru-cache';
import { GRID_DEFAULT } from '../../configs';
import type { IRectangle } from '../../interface';
import { GridInnerIcon } from '../../managers';
import { isPointInsideRectangle } from '../../utils';
import { drawAvatar, drawRect, drawSingleLineText } from '../base-renderer';
import { CellRegionType, CellType } from './interface';
import type {
  IInternalCellRenderer,
  ICellRenderProps,
  IUserCell,
  ICellMeasureProps,
  ICellClickProps,
  ICellClickCallback,
} from './interface';

const ITEM_HEIGHT = 24;
const ITEM_HORIZONTAL_GAP = 6;
const ITEM_PADDING_LEFT = 2;
const CELL_VERTICAL_PADDING = 4;

enum IUserRegionType {
  DeleteBtn = 'DeleteBtn',
  Chip = 'Chip',
}

interface IUserRegion extends IRectangle {
  type: IUserRegionType;
  index: number;
}

const positionCache: LRUCache<string, IUserRegion[]> = new LRUCache({
  max: 10,
});

const { cellHorizontalPadding, cellVerticalPaddingSM, maxRowCount } = GRID_DEFAULT;

type IUserCellRegionResult =
  | {
      type: CellRegionType.Update;
      data: IUserCell['data'] | null;
    }
  | {
      type: CellRegionType.Hover;
      data: IRectangle & { user: IUserCell['data'][number] };
    };

const getCacheKey = (width: number, userSets: IUserCell['data']) => {
  return `${String(width)}-${userSets.map((u) => u.id).join(',')}`;
};

const getVisibleRows = (isActive: boolean, drawAreaHeight: number) => {
  if (isActive) return Infinity;
  return Math.max(
    1,
    Math.floor((drawAreaHeight - ITEM_HEIGHT) / (ITEM_HEIGHT + cellVerticalPaddingSM)) + 1
  );
};

const clipInactiveCell = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  isActive: boolean
) => {
  if (isActive) return;
  ctx.rect(x, y, width, height);
  ctx.clip();
};

const getDeleteRegionResult = (
  positions: IUserRegion[],
  hoverX: number,
  adjustedY: number,
  data: IUserCell['data'],
  shouldCalculate?: boolean
): IUserCellRegionResult | null => {
  for (const pos of positions) {
    if (pos.type !== IUserRegionType.DeleteBtn) continue;
    const { x, y, width, height } = pos;
    if (isPointInsideRectangle([hoverX, adjustedY], [x, y], [x + width, y + height])) {
      if (!shouldCalculate) return { type: CellRegionType.Update, data: null };
      const result = data.filter((_, index) => index !== pos.index);
      return {
        type: CellRegionType.Update,
        data: result.length ? result : null,
      };
    }
  }

  return null;
};

const getChipRegionResult = (
  positions: IUserRegion[],
  hoverX: number,
  adjustedY: number,
  scrollTop: number,
  data: IUserCell['data']
): IUserCellRegionResult | null => {
  for (const pos of positions) {
    if (pos.type !== IUserRegionType.Chip) continue;
    const { x, y, width, height } = pos;
    if (isPointInsideRectangle([hoverX, adjustedY], [x, y], [x + width, y + height])) {
      return {
        type: CellRegionType.Hover,
        data: { x, y: y - scrollTop, width, height, user: data[pos.index] },
      };
    }
  }

  return null;
};

export const userCellRenderer: IInternalCellRenderer<IUserCell> = {
  type: CellType.User,
  needsHover: false,
  needsHoverPosition: false,
  needsHoverPositionWhenActive: true,
  measure: (cell: IUserCell, props: ICellMeasureProps) => {
    const { data: userSets, readonly } = cell;
    const { ctx, theme, width, height } = props;
    const { fontSizeXS, iconSizeSM, cellOptionTextColor, fontFamily } = theme;

    if (!userSets.length) return { width, height, totalHeight: height };

    const drawArea: IRectangle = {
      x: cellHorizontalPadding,
      y: CELL_VERTICAL_PADDING,
      width: width - 2 * cellHorizontalPadding,
      height: height - CELL_VERTICAL_PADDING,
    };

    let lineCount = 1;
    let x = drawArea.x;
    let y = drawArea.y;
    const deleteBtnWidth = !readonly ? fontSizeXS : 0;
    const fixedWidthWithoutText =
      ITEM_PADDING_LEFT +
      iconSizeSM +
      ITEM_HORIZONTAL_GAP +
      (deleteBtnWidth ? ITEM_HORIZONTAL_GAP + deleteBtnWidth : 0) +
      cellHorizontalPadding;
    const maxTextWidth = Math.max(0, drawArea.width - fixedWidthWithoutText);
    const rightEdgeOfDrawArea = drawArea.x + drawArea.width;
    const lineHeight = ITEM_HEIGHT + cellVerticalPaddingSM;

    const cacheKey = getCacheKey(width, userSets);
    const positions: IUserRegion[] = [];

    for (let i = 0; i < userSets.length; i++) {
      const user = userSets[i];
      const text = user.name;
      ctx.font = `${fontSizeXS}px ${fontFamily}`;
      const { width: displayWidth } = drawSingleLineText(ctx, {
        text,
        fill: cellOptionTextColor,
        maxWidth: maxTextWidth,
        needRender: false,
        fontSize: fontSizeXS,
      });

      const textWidth = displayWidth;
      const chipWidth = Math.min(fixedWidthWithoutText + textWidth, drawArea.width);

      if (x !== drawArea.x && x + chipWidth > rightEdgeOfDrawArea) {
        lineCount++;
        x = drawArea.x;
        y += lineHeight;
      }

      const rectX = x;
      const rectY = y;

      positions.push({
        type: IUserRegionType.Chip,
        index: i,
        x: rectX,
        y: rectY,
        width: chipWidth,
        height: ITEM_HEIGHT,
      });

      if (!readonly) {
        const deleteX = rectX + chipWidth - cellHorizontalPadding - fontSizeXS;
        positions.push({
          type: IUserRegionType.DeleteBtn,
          index: i,
          x: deleteX,
          y: rectY + (ITEM_HEIGHT - fontSizeXS) / 2,
          width: fontSizeXS,
          height: fontSizeXS,
        });
      }

      x += chipWidth + 8;
    }

    positionCache.set(cacheKey, positions);

    const totalHeight = CELL_VERTICAL_PADDING + lineCount * lineHeight;
    const displayRowCount = Math.min(maxRowCount, lineCount);

    return {
      width,
      height: Math.max(height, CELL_VERTICAL_PADDING + displayRowCount * lineHeight),
      totalHeight,
    };
  },
  draw: (cell: IUserCell, props: ICellRenderProps) => {
    const { ctx, rect, theme, imageManager, columnIndex, rowIndex, spriteManager, isActive } =
      props;
    const { data: userSets, readonly } = cell;
    const { x: _x, y: _y, width, height } = rect;
    const {
      fontSizeXS,
      fontSizeSM,
      fontFamily,
      iconSizeSM,
      cellOptionBg,
      cellOptionTextColor,
      avatarBg,
      avatarTextColor,
    } = theme;

    if (!userSets.length) return;

    const drawArea: IRectangle = {
      x: _x + cellHorizontalPadding,
      y: _y + CELL_VERTICAL_PADDING,
      width: width - 2 * cellHorizontalPadding,
      height: height - 2 * CELL_VERTICAL_PADDING,
    };
    const rows = getVisibleRows(!!isActive, drawArea.height);
    const editable = !readonly && !!isActive;
    const deleteBtnWidth = editable ? fontSizeXS : 0;
    const fixedWidthWithoutText =
      ITEM_PADDING_LEFT +
      iconSizeSM +
      ITEM_HORIZONTAL_GAP +
      (deleteBtnWidth ? ITEM_HORIZONTAL_GAP + deleteBtnWidth : 0) +
      cellHorizontalPadding;
    const maxTextWidth = Math.max(0, drawArea.width - fixedWidthWithoutText);

    ctx.save();
    ctx.beginPath();
    clipInactiveCell(ctx, _x, _y, width, height, !!isActive);

    ctx.font = `${fontSizeXS}px ${fontFamily}`;

    let row = 1;
    let x = drawArea.x;
    let y = drawArea.y;

    for (const user of userSets) {
      const { name: text, avatarUrl } = user;

      const { width: displayWidth, text: displayText } = drawSingleLineText(ctx, {
        text,
        fill: cellOptionTextColor,
        maxWidth: maxTextWidth,
        needRender: false,
        fontSize: fontSizeXS,
      });

      const textWidth = displayWidth;
      const chipWidth = Math.min(fixedWidthWithoutText + textWidth, drawArea.width);

      if (x !== drawArea.x && x + chipWidth > drawArea.x + drawArea.width && row < rows) {
        row++;
        y += ITEM_HEIGHT + cellVerticalPaddingSM;
        x = drawArea.x;
      }

      const rectX = x;
      const rectY = y;
      drawRect(ctx, {
        x: rectX,
        y: rectY,
        width: chipWidth,
        height: ITEM_HEIGHT,
        radius: ITEM_HEIGHT / 2,
        fill: cellOptionBg,
      });
      drawSingleLineText(ctx, {
        text: displayText,
        x: rectX + ITEM_PADDING_LEFT + iconSizeSM + ITEM_HORIZONTAL_GAP,
        y: rectY + (ITEM_HEIGHT - fontSizeXS) / 2 + 0.5,
        fill: cellOptionTextColor,
        maxWidth: maxTextWidth,
      });

      if (editable) {
        spriteManager.drawSprite(ctx, {
          sprite: GridInnerIcon.Close,
          x: rectX + chipWidth - cellHorizontalPadding - fontSizeXS,
          y: rectY + (ITEM_HEIGHT - fontSizeXS) / 2,
          size: fontSizeXS,
          theme,
          colors: [cellOptionTextColor, cellOptionTextColor],
        });
      }

      const img = avatarUrl
        ? imageManager.loadOrGetImage(avatarUrl, columnIndex, rowIndex)
        : undefined;

      drawAvatar(ctx, {
        x: rectX + ITEM_PADDING_LEFT,
        y: rectY + (ITEM_HEIGHT - iconSizeSM) / 2,
        width: iconSizeSM,
        height: iconSizeSM,
        fill: avatarBg,
        stroke: cellOptionBg,
        defaultText: text,
        textColor: avatarTextColor,
        fontSize: fontSizeSM,
        fontFamily,
        img,
      });

      x += chipWidth + 8;
      if (x > drawArea.x + drawArea.width && row >= rows) break;
    }

    ctx.restore();
  },
  checkRegion: (cell: IUserCell, props: ICellClickProps, shouldCalculate?: boolean) => {
    const { data, readonly } = cell;
    const { width, isActive, hoverCellPosition, activeCellBound } = props;

    const [hoverX, hoverY] = hoverCellPosition;
    const cacheKey = getCacheKey(width, data);
    const positions = positionCache.get(cacheKey);

    if (!positions) return { type: CellRegionType.Blank };

    const editable = !readonly && isActive && activeCellBound;
    const scrollTop = activeCellBound?.scrollTop ?? 0;
    const adjustedY = scrollTop + hoverY;

    if (editable) {
      const deleteRegion = getDeleteRegionResult(
        positions,
        hoverX,
        adjustedY,
        data,
        shouldCalculate
      );
      if (deleteRegion) return deleteRegion;
    }

    const chipRegion = getChipRegionResult(positions, hoverX, adjustedY, scrollTop, data);
    if (chipRegion) return chipRegion;

    return { type: CellRegionType.Blank };
  },
  onClick: (cell: IUserCell, props: ICellClickProps, callback: ICellClickCallback) => {
    const cellRegion = userCellRenderer.checkRegion?.(cell, props, true);
    if (!cellRegion) return;
    if (cellRegion.type === CellRegionType.Update) {
      return callback(cellRegion);
    }
  },
};
