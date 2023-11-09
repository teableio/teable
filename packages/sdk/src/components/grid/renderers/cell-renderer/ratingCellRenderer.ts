import { GRID_DEFAULT } from '../../configs';
import { hexToRGBA, inRange } from '../../utils';
import { CellType } from './interface';
import type {
  IInternalCellRenderer,
  ICellRenderProps,
  IRatingCell,
  ICellClickProps,
} from './interface';

const gapSize = 3;

export const ratingCellRenderer: IInternalCellRenderer<IRatingCell> = {
  type: CellType.Rating,
  needsHover: true,
  needsHoverPosition: true,
  draw: (cell: IRatingCell, props: ICellRenderProps) => {
    const { data, icon, color, max, readonly } = cell;
    const { ctx, theme, rect, hoverCellPosition, spriteManager } = props;
    const { x, y, width, height } = rect;
    const { cellHorizontalPadding } = GRID_DEFAULT;
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
  checkWithinBound: (cell: IRatingCell, props: ICellClickProps) => {
    const { max, readonly } = cell;
    if (readonly) return false;
    const { hoverCellPosition, height, theme } = props;
    const { cellHorizontalPadding } = GRID_DEFAULT;
    const [x, y] = hoverCellPosition;
    const { iconSizeXS } = theme;
    const minX = cellHorizontalPadding;
    const maxX = minX + max * (iconSizeXS + gapSize);

    return Boolean(
      inRange(x, minX, maxX) && inRange(y, height / 2 - iconSizeXS, height / 2 + iconSizeXS)
    );
  },
  onClick: (cell: IRatingCell, props: ICellClickProps) => {
    if (!ratingCellRenderer.checkWithinBound?.(cell, props)) return undefined;

    const { data, readonly } = cell;
    if (readonly) return false;
    const { hoverCellPosition, theme } = props;
    const { cellHorizontalPadding } = GRID_DEFAULT;
    const [x] = hoverCellPosition;
    const { iconSizeXS } = theme;
    const newData = Math.ceil((x - cellHorizontalPadding) / (iconSizeXS + gapSize));
    return newData !== data ? newData : null;
  },
};
