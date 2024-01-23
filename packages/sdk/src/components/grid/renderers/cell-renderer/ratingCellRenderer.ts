import { GRID_DEFAULT } from '../../configs';
import { hexToRGBA, inRange } from '../../utils';
import { CellRegionType, CellType } from './interface';
import type {
  IInternalCellRenderer,
  ICellRenderProps,
  IRatingCell,
  ICellClickProps,
  ICellClickCallback,
} from './interface';

const gapSize = 3;

const { cellHorizontalPadding } = GRID_DEFAULT;

export const ratingCellRenderer: IInternalCellRenderer<IRatingCell> = {
  type: CellType.Rating,
  needsHover: true,
  needsHoverPosition: true,
  draw: (cell: IRatingCell, props: ICellRenderProps) => {
    const { data, icon, color, max, readonly } = cell;
    const { ctx, theme, rect, hoverCellPosition, spriteManager } = props;
    const { x, y, width, height } = rect;
    const [hoverX, hoverY] = hoverCellPosition ?? [0, 0];
    const { iconSizeXS, iconFgHighlight, cellLineColor } = theme;

    if (data == null) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    let currentX = x + cellHorizontalPadding;
    const verticalPadding = (height - iconSizeXS) / 2;
    const initY = y + verticalPadding;
    const isVerticalRange = inRange(hoverY, verticalPadding, verticalPadding + iconSizeXS);
    const iconColor = color ?? iconFgHighlight;
    const hoverColor = hexToRGBA(iconColor, 0.3);
    const maxHoverX = cellHorizontalPadding + max * (iconSizeXS + gapSize);

    for (let i = 0; i < max; i++) {
      const isHighlight = data > i;
      const isHovered = hoverX >= currentX - x && hoverX < maxHoverX;
      let color: string;

      if (isHighlight) {
        color = iconColor;
      } else if (!readonly && isVerticalRange && isHovered) {
        color = hoverColor;
      } else {
        color = cellLineColor;
      }

      spriteManager.drawSprite(ctx, {
        sprite: icon,
        x: currentX,
        y: initY,
        size: iconSizeXS,
        colors: [color, color],
        theme,
      });
      currentX += iconSizeXS + gapSize;
    }

    ctx.restore();
  },
  checkRegion: (cell: IRatingCell, props: ICellClickProps, shouldCalculate?: boolean) => {
    const { data, max, readonly } = cell;
    if (readonly) return { type: CellRegionType.Blank };
    const { hoverCellPosition, height, theme } = props;
    const [x, y] = hoverCellPosition;
    const { iconSizeXS } = theme;
    const minX = cellHorizontalPadding;
    const maxX = minX + max * (iconSizeXS + gapSize);

    if (inRange(x, minX, maxX) && inRange(y, height / 2 - iconSizeXS, height / 2 + iconSizeXS)) {
      if (!shouldCalculate) return { type: CellRegionType.Update, data: null };
      const newData = Math.ceil((x - cellHorizontalPadding) / (iconSizeXS + gapSize));
      return {
        type: CellRegionType.Update,
        data: newData !== data ? newData : null,
      };
    }
    return { type: CellRegionType.Blank };
  },
  onClick: (cell: IRatingCell, props: ICellClickProps, callback: ICellClickCallback) => {
    const cellRegion = ratingCellRenderer.checkRegion?.(cell, props, true);
    if (!cellRegion || cellRegion.type === CellRegionType.Blank) return;
    callback(cellRegion);
  },
};
