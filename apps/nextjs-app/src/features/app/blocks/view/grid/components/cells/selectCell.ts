import type { Rectangle } from '@glideapps/glide-data-grid';
import { getMiddleCenterBias, measureTextCached } from '@glideapps/glide-data-grid';
import type { DrawArgs } from '@glideapps/glide-data-grid/dist/ts/data-grid/cells/cell-types';
import { INNER_PAD, TAG_HEIGHT } from './constant';
import { roundedRect } from './draw-fns';
import type { ICustomCellGridCell, ISelectGridCell } from './type';

export const selectCell = (args: DrawArgs<ICustomCellGridCell>, cell: ICustomCellGridCell) => {
  const { ctx, theme, rect } = args;
  const { value } = cell.data as ISelectGridCell;

  const drawArea: Rectangle = {
    x: rect.x + theme.cellHorizontalPadding,
    y: rect.y + theme.cellVerticalPadding,
    width: rect.width - 2 * theme.cellHorizontalPadding,
    height: rect.height - 2 * theme.cellVerticalPadding,
  };
  const rows = Math.max(1, Math.floor(drawArea.height / (TAG_HEIGHT + INNER_PAD)));

  let x = drawArea.x;
  let row = 1;
  let y = drawArea.y + (drawArea.height - rows * TAG_HEIGHT - (rows - 1) * INNER_PAD) / 2;
  for (const item of value) {
    ctx.font = `12px ${theme.fontFamily}`;
    const metrics = measureTextCached(item, ctx);
    const width = metrics.width + INNER_PAD * 2;
    const textY = TAG_HEIGHT / 2;

    if (x !== drawArea.x && x + width > drawArea.x + drawArea.width && row < rows) {
      row++;
      y += TAG_HEIGHT + INNER_PAD;
      x = drawArea.x;
    }

    // background color
    ctx.fillStyle = theme.bgBubble;
    ctx.beginPath();
    roundedRect(ctx, x, y, width, TAG_HEIGHT, TAG_HEIGHT / 2);
    ctx.fill();

    // font text
    ctx.fillStyle = theme.textDark;
    ctx.fillText(
      item,
      x + INNER_PAD,
      y + textY + getMiddleCenterBias(ctx, `12px ${theme.fontFamily}`)
    );

    x += width + 8;
    if (x > drawArea.x + drawArea.width && row >= rows) break;
  }
};
