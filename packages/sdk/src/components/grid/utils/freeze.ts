export const MIN_FREEZE_SCROLLABLE_WIDTH = 240;

export interface IFreezeColumnLimitOptions {
  containerWidth: number;
  columnInitSize: number;
  columnCount: number;
  getColumnWidth: (index: number) => number;
  minScrollableWidth?: number;
}

export const getMaxFreezeColumnCount = ({
  containerWidth,
  columnInitSize,
  columnCount,
  getColumnWidth,
  minScrollableWidth = MIN_FREEZE_SCROLLABLE_WIDTH,
}: IFreezeColumnLimitOptions) => {
  const maxFreezeWidth = containerWidth - minScrollableWidth;

  if (maxFreezeWidth <= columnInitSize) {
    return 0;
  }

  let freezeWidth = columnInitSize;

  for (let index = 0; index < columnCount; index++) {
    freezeWidth += getColumnWidth(index) ?? 0;

    if (freezeWidth > maxFreezeWidth) {
      return index;
    }
  }

  return columnCount;
};

export const canFreezeColumnCount = (
  freezeColumnCount: number,
  options: IFreezeColumnLimitOptions
) => {
  if (freezeColumnCount <= 0) {
    return true;
  }

  return freezeColumnCount <= getMaxFreezeColumnCount(options);
};
