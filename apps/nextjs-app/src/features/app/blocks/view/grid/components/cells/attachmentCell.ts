import type { DrawArgs } from '@glideapps/glide-data-grid/dist/ts/data-grid/cells/cell-types';
import { getAttachmentUrl } from '@/features/app/components/upload-attachment/UploadAttachment';
import { getFileCover } from '@/features/app/utils';
import { INNER_PAD } from './constant';
import { roundedRect } from './draw-fns';
import type { IAttachmentGridCell, ICustomCellGridCell } from './type';

export const attachmentCell = (args: DrawArgs<ICustomCellGridCell>, cell: ICustomCellGridCell) => {
  const { rect, col, row, theme, ctx, imageLoader } = args;
  const { x, y, height: h } = rect;
  const { value } = cell.data as IAttachmentGridCell;

  const imgHeight = h - theme.cellVerticalPadding * 2;
  const images: (HTMLImageElement | ImageBitmap)[] = [];
  let totalWidth = 0;
  for (let index = 0; index < value.length; index++) {
    const attachment = value[index];
    const url = getAttachmentUrl(attachment);
    const img = imageLoader.loadOrGetImage(getFileCover(attachment.mimetype, url), col, row);

    if (img !== undefined) {
      images[index] = img;
      const imgWidth = img.width * (imgHeight / img.height);
      totalWidth += imgWidth + INNER_PAD;
    }
  }

  if (totalWidth === 0) return;
  totalWidth -= INNER_PAD;

  let drawX = x + theme.cellHorizontalPadding;

  for (const img of images) {
    if (img === undefined) continue; // array is sparse
    const imgWidth = img.width * (imgHeight / img.height);
    if (INNER_PAD > 0) {
      roundedRect(ctx, drawX, y + theme.cellVerticalPadding, imgWidth, imgHeight, INNER_PAD);
      ctx.save();
      ctx.clip();
    }
    ctx.drawImage(img, drawX, y + theme.cellVerticalPadding, imgWidth, imgHeight);
    if (INNER_PAD > 0) {
      ctx.restore();
    }

    drawX += imgWidth + INNER_PAD;
  }
};
