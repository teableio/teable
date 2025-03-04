import { LRUCache } from 'lru-cache';
import { GRID_DEFAULT } from '../../configs';
import type { IRectangle } from '../../interface';
import { GridInnerIcon } from '../../managers';
import { isPointInsideRectangle } from '../../utils';
import { drawRect } from '../base-renderer';
import type {
  ICellClickCallback,
  ICellClickProps,
  ICellRenderProps,
  IImageCell,
  IImageData,
  IInternalCellRenderer,
} from './interface';
import { CellRegionType, CellType } from './interface';

const imagePositionCache: LRUCache<string, (IRectangle & { id: string })[]> = new LRUCache({
  max: 100,
});

const INNER_PADDING = 4;

const { cellHorizontalPadding, cellVerticalPaddingXS } = GRID_DEFAULT;

const getImageCollection = (
  data: IImageData[],
  loadImg: (url: string) => HTMLImageElement | ImageBitmap | undefined
) => {
  const collection: { id: string; img: HTMLImageElement | ImageBitmap }[] = [];

  for (let index = 0; index < data.length; index++) {
    const { id, url } = data[index];
    const img = loadImg(url);

    if (img !== undefined) {
      collection.push({ id, img });
    }
  }

  return collection;
};

const generateCacheKey = (data: IImageData[], width: number) => {
  return `${String(width)}-${data.map(({ id }) => id).join(',')}`;
};

export const imageCellRenderer: IInternalCellRenderer<IImageCell> = {
  type: CellType.Image,
  needsHoverWhenActive: true,
  needsHoverPositionWhenActive: true,
  draw: (cell: IImageCell, props: ICellRenderProps) => {
    const { rect, columnIndex, rowIndex, theme, ctx, imageManager, isActive, spriteManager } =
      props;
    const { iconSizeSM, cellLineColor } = theme;
    const { data, readonly } = cell;
    const { x, y, width, height } = rect;
    const editable = !readonly && isActive;
    const initPadding = editable ? iconSizeSM + 2 : 0;
    const imgHeight = height - cellVerticalPaddingXS * 2;

    const imageCollection = getImageCollection(data, (url) =>
      imageManager.loadOrGetImage(url, columnIndex, rowIndex)
    );

    if (editable) {
      spriteManager.drawSprite(ctx, {
        sprite: GridInnerIcon.Add,
        x: x + cellHorizontalPadding - 2,
        y: y + (height - iconSizeSM) / 2,
        size: iconSizeSM,
        theme,
      });
    }

    if (!imageCollection.length) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width - 0.5, height);
    ctx.clip();

    const cacheKey = generateCacheKey(data, width);
    const positions: (IRectangle & { id: string })[] = [];

    let drawX = x + cellHorizontalPadding + initPadding;

    for (const imgItem of imageCollection) {
      if (drawX > x + width) break;
      const { id, img } = imgItem;
      const imgWidth = img.width * (imgHeight / img.height);
      drawRect(ctx, {
        x: drawX,
        y: y + cellVerticalPaddingXS,
        width: imgWidth,
        height: imgHeight,
        radius: INNER_PADDING,
        stroke: cellLineColor,
      });

      ctx.save();
      drawRect(ctx, {
        x: drawX,
        y: y + cellVerticalPaddingXS,
        width: imgWidth,
        height: imgHeight,
        radius: INNER_PADDING,
      });
      ctx.clip();
      ctx.drawImage(img, drawX, y + cellVerticalPaddingXS, imgWidth, imgHeight);
      ctx.restore();

      positions.push({
        id,
        x: drawX - x,
        y: cellVerticalPaddingXS,
        width: imgWidth,
        height: imgHeight,
      });
      drawX += imgWidth + INNER_PADDING;
    }

    imagePositionCache.set(cacheKey, positions);

    ctx.restore();
  },
  checkRegion: (cell: IImageCell, props: ICellClickProps, _shouldCalculate?: boolean) => {
    const { data, readonly } = cell;
    const { width, height, theme, isActive, hoverCellPosition } = props;
    const editable = !readonly && isActive;

    const { iconSizeSM } = theme;
    const [hoverX, hoverY] = hoverCellPosition;
    const startX = cellHorizontalPadding;
    const startY = (height - iconSizeSM) / 2;

    if (
      editable &&
      isPointInsideRectangle(
        [hoverX, hoverY],
        [startX, startY],
        [startX + iconSizeSM, startY + iconSizeSM]
      )
    ) {
      return { type: CellRegionType.ToggleEditing, data: null };
    }

    const cacheKey = generateCacheKey(data, width);
    const imagePositions = imagePositionCache.get(cacheKey);

    if (imagePositions == null) return { type: CellRegionType.Blank };

    for (let i = 0; i < imagePositions.length; i++) {
      const { id, x, y, width, height } = imagePositions[i];

      if (isPointInsideRectangle([hoverX, hoverY], [x, y], [x + width, y + height])) {
        return {
          type: CellRegionType.Preview,
          data: id,
        };
      }
    }

    return { type: CellRegionType.Blank };
  },
  onClick: (cell: IImageCell, props: ICellClickProps, callback: ICellClickCallback) => {
    const cellRegion = imageCellRenderer.checkRegion?.(cell, props, true);
    if (!cellRegion || cellRegion.type === CellRegionType.Blank) return;
    if (cellRegion.type === CellRegionType.Preview) {
      cell?.onPreview?.(cellRegion.data as string);
      return callback(cellRegion);
    }
    callback(cellRegion);
  },
};
