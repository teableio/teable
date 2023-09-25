import { inRange } from '../../utils';
import { drawCheckbox } from '../base-renderer';
import { CellType } from './interface';
import type {
  IInternalCellRenderer,
  ICellRenderProps,
  IBooleanCell,
  ICellClickProps,
} from './interface';

export const booleanCellRenderer: IInternalCellRenderer<IBooleanCell> = {
  type: CellType.Boolean,
  needsHover: true,
  needsHoverPosition: true,
  draw: (cell: IBooleanCell, props: ICellRenderProps) => {
    const { data, isMultiple } = cell;
    const { ctx, rect, theme } = props;
    const { x, y, width, height } = rect;
    const { iconSizeSM, staticWhite, iconBgSelected, rowHeaderTextColor, cellHorizontalPadding } =
      theme;
    const halfIconSize = iconSizeSM / 2;

    if (!isMultiple) {
      return drawCheckbox(ctx, {
        x: x + width / 2 - halfIconSize,
        y: y + height / 2 - halfIconSize,
        size: iconSizeSM,
        stroke: data ? staticWhite : rowHeaderTextColor,
        fill: data ? iconBgSelected : undefined,
        isChecked: data,
      });
    }

    if (isMultiple && Array.isArray(data)) {
      let startX = x + cellHorizontalPadding;
      const startY = y + height / 2 - halfIconSize;
      data.forEach((check) => {
        if (check) {
          drawCheckbox(ctx, {
            x: startX,
            y: startY,
            size: iconSizeSM,
            stroke: staticWhite,
            fill: iconBgSelected,
            isChecked: true,
          });
          startX += iconSizeSM + cellHorizontalPadding / 2;
        }
      });
    }
  },
  checkWithinBound: (_cell: IBooleanCell, props: ICellClickProps) => {
    const { hoverCellPosition, width, height, theme } = props;
    const [x, y] = hoverCellPosition;
    const { iconSizeSM } = theme;
    const halfIconSize = iconSizeSM / 2;

    return Boolean(
      inRange(x, width / 2 - halfIconSize, width / 2 + halfIconSize) &&
        inRange(y, height / 2 - halfIconSize, height / 2 + halfIconSize)
    );
  },
  onClick: (cell: IBooleanCell, props: ICellClickProps) => {
    const { data } = cell;
    return booleanCellRenderer.checkWithinBound?.(cell, props) ? !data : undefined;
  },
};
