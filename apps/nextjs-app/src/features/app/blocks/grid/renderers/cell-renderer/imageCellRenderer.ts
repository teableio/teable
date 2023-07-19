/* eslint-disable @typescript-eslint/naming-convention */
import { drawRect } from '../base-renderer';
import type { ICellRenderProps, IImageCell, IInternalCellRenderer } from './interface';
import { CellType } from './interface';

const INNER_PAD = 4;

export const imageCellRenderer: IInternalCellRenderer<IImageCell> = {
  type: CellType.Image,
  needsHover: false,
  needsHoverPosition: false,
  draw: (cell: IImageCell, props: ICellRenderProps) => {
    const { rect, columnIndex, rowIndex, theme, ctx, imageManager } = props;
    const { cellVerticalPadding, cellHorizontalPadding } = theme;
    const { x, y, width, height } = rect;
    const urls = cell.displayData;

    const imgHeight = height - cellVerticalPadding * 2;
    const images: (HTMLImageElement | ImageBitmap)[] = [];
    let totalWidth = 0;
    for (let index = 0; index < urls.length; index++) {
      const url = urls[index];
      const img = imageManager.loadOrGetImage(url, columnIndex, rowIndex);

      if (img !== undefined) {
        images[index] = img;
        const imgWidth = img.width * (imgHeight / img.height);
        totalWidth += imgWidth + INNER_PAD;
      }
    }

    if (totalWidth === 0) return;
    totalWidth -= INNER_PAD;

    let drawX = x + cellHorizontalPadding;

    ctx.save();
    ctx.beginPath();

    if (images.length) {
      ctx.rect(x, y, width, height);
      ctx.clip();
    }

    for (const img of images) {
      if (img === undefined) continue;
      const imgWidth = img.width * (imgHeight / img.height);
      ctx.save();
      drawRect(ctx, {
        x: drawX,
        y: y + cellVerticalPadding,
        width: imgWidth,
        height: imgHeight,
        radius: INNER_PAD,
      });
      ctx.clip();

      ctx.drawImage(img, drawX, y + cellVerticalPadding, imgWidth, imgHeight);

      ctx.restore();

      drawX += imgWidth + INNER_PAD;
    }

    ctx.restore();
  },
};
