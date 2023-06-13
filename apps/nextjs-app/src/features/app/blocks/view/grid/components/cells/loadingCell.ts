import type { DrawArgs } from '@glideapps/glide-data-grid/dist/ts/data-grid/cells/cell-types';
import { roundedRect } from './draw-fns';
import type { ICustomCellGridCell } from './type';

export const loadingCell = (args: DrawArgs<ICustomCellGridCell>, _cell: ICustomCellGridCell) => {
  const { ctx, theme, rect } = args;
  const x = rect.x + theme.cellHorizontalPadding * 2;
  const y = rect.y + theme.cellVerticalPadding * 2;
  const width = rect.width - 4 * theme.cellHorizontalPadding;
  const height = rect.height - 4 * theme.cellVerticalPadding;

  ctx.fillStyle = theme.accentLight;
  roundedRect(ctx, x, y, width, height, 2);
  ctx.fill();
};
