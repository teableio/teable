import { GRID_DEFAULT } from '../../configs';
import { GridInnerIcon } from '../../managers';
import { isPointInsideRectangle } from '../../utils';
import { drawRect } from '../base-renderer';
import type {
  ICellClickCallback,
  ICellClickProps,
  ICellRenderProps,
  IImageCell,
  IInternalCellRenderer,
} from './interface';
import { CellRegionType, CellType } from './interface';

const INNER_PADDING = 4;

const { cellHorizontalPadding, cellVerticalPaddingXS } = GRID_DEFAULT;

const getImages = (
  urls: string[],
  loadImg: (url: string) => HTMLImageElement | ImageBitmap | undefined
) => {
  const images: (HTMLImageElement | ImageBitmap)[] = [];

  for (let index = 0; index < urls.length; index++) {
    const url = urls[index];
    const img = loadImg(url);

    if (img !== undefined) {
      images.push(img);
    }
  }

  return images;
};

export const imageCellRenderer: IInternalCellRenderer<IImageCell> = {
  type: CellType.Image,
  needsHoverWhenActive: true,
  needsHoverPositionWhenActive: true,
  draw: (cell: IImageCell, props: ICellRenderProps) => {
    const { rect, columnIndex, rowIndex, theme, ctx, imageManager, isActive, spriteManager } =
      props;
    const { iconSizeSM } = theme;
    const { displayData: urls, readonly } = cell;
    const { x, y, width, height } = rect;
    const editable = !readonly && isActive;
    const initPadding = editable ? iconSizeSM + 2 : 0;
    const imgHeight = height - cellVerticalPaddingXS * 2;

    const images = getImages(urls, (url) =>
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

    if (!images.length) return;

    let drawX = x + cellHorizontalPadding + initPadding;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width - 0.5, height);
    ctx.clip();

    for (const img of images) {
      if (drawX > x + width) break;
      const imgWidth = img.width * (imgHeight / img.height);

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

      drawX += imgWidth + INNER_PADDING;
    }

    ctx.restore();
  },
  checkRegion: (cell: IImageCell, props: ICellClickProps, _shouldCalculate?: boolean) => {
    const { readonly } = cell;
    const { height, theme, isActive, hoverCellPosition } = props;
    const editable = !readonly && isActive;
    if (!editable) return { type: CellRegionType.Blank };

    const { iconSizeSM } = theme;
    const [hoverX, hoverY] = hoverCellPosition;
    const startX = cellHorizontalPadding;
    const startY = (height - iconSizeSM) / 2;

    if (
      isPointInsideRectangle(
        [hoverX, hoverY],
        [startX, startY],
        [startX + iconSizeSM, startY + iconSizeSM]
      )
    ) {
      return { type: CellRegionType.ToggleEditing, data: null };
    }
    return { type: CellRegionType.Blank };
  },
  onClick: (cell: IImageCell, props: ICellClickProps, callback: ICellClickCallback) => {
    const cellRegion = imageCellRenderer.checkRegion?.(cell, props, true);
    if (!cellRegion || cellRegion.type === CellRegionType.Blank) return;
    callback(cellRegion);
  },
};
