import type { IGridTheme } from '../configs';
import { RowControlType, type IRowControlItem } from '../interface';

export const getRowControlExtraWidth = (
  theme: IGridTheme,
  rowControlPaddingX: number | undefined
) => {
  if (!rowControlPaddingX) return 0;
  return Math.max(rowControlPaddingX - (theme.iconSizeMD - theme.iconSizeXS) / 2, 0);
};

export const getRowControlLayoutWidth = (
  width: number,
  theme: IGridTheme,
  rowControlPaddingX: number | undefined
) => {
  return Math.max(width - getRowControlExtraWidth(theme, rowControlPaddingX) * 2, 0);
};

export const getRowControlOffsetX = (
  width: number,
  theme: IGridTheme,
  rowControlPaddingX: number | undefined,
  rowControlCount: number,
  rowControlIndex: number
) => {
  const leadingExtraWidth = getRowControlExtraWidth(theme, rowControlPaddingX);
  const layoutWidth = getRowControlLayoutWidth(width, theme, rowControlPaddingX);
  return leadingExtraWidth + (layoutWidth / (rowControlCount || 1)) * (rowControlIndex + 0.5);
};

export const getRowControlCheckboxOffsetX = ({
  width,
  theme,
  rowControls,
  rowControlPaddingX,
}: {
  width: number;
  theme: IGridTheme;
  rowControls: IRowControlItem[];
  rowControlPaddingX?: number;
}) => {
  if (!rowControlPaddingX) return width / 2;
  const checkboxIndex = rowControls.findIndex((item) => item.type === RowControlType.Checkbox);
  if (checkboxIndex < 0) return width / 2;
  return getRowControlOffsetX(width, theme, rowControlPaddingX, rowControls.length, checkboxIndex);
};
