import type { ICellItem, IRange } from '../interface';
import type { CombinedSelection } from '../managers';

export const isRangeWithinRanges = (checkedRange: IRange, ranges: IRange[]) => {
  const [checkedStart, checkedEnd] = checkedRange;

  for (const range of ranges) {
    const [rangeStart, rangeEnd] = range;

    if (rangeStart <= checkedStart && rangeEnd >= checkedEnd) {
      return true;
    }
  }
  return false;
};

export const flatRanges = (ranges: IRange[]): number[] => {
  const result: number[] = [];
  for (const range of ranges) {
    for (let i = range[0]; i <= range[1]; i++) {
      result.push(i);
    }
  }
  return result;
};

export const isPointInsideRectangle = (
  checkPoint: [number, number],
  startPoint: [number, number],
  endPoint: [number, number]
): boolean => {
  const [checkX, checkY] = checkPoint;
  const [startX, startY] = startPoint;
  const [endX, endY] = endPoint;

  const minX = Math.min(startX, endX);
  const maxX = Math.max(startX, endX);
  const minY = Math.min(startY, endY);
  const maxY = Math.max(startY, endY);

  return checkX >= minX && checkX <= maxX && checkY >= minY && checkY <= maxY;
};

export const inRange = (num: number, start: number, end: number) => {
  if (start > end) {
    return num >= end && num <= start;
  }
  return num >= start && num <= end;
};

export const serializedRanges = (ranges: IRange[]): IRange[] => {
  if (ranges.length <= 1) {
    return ranges;
  }

  const sortedRanges = [...ranges].sort((a, b) => a[0] - b[0]);
  const mergedRanges: IRange[] = [];
  let currentRange: IRange = [...sortedRanges[0]];

  for (let i = 1; i < sortedRanges.length; i++) {
    const nextRange = sortedRanges[i];
    if (nextRange[0] <= currentRange[1] + 1) {
      currentRange = [currentRange[0], Math.max(currentRange[1], nextRange[1])];
    } else {
      mergedRanges.push(currentRange);
      currentRange = [...nextRange];
    }
  }
  mergedRanges.push(currentRange);

  return mergedRanges;
};

// eslint-disable-next-line sonarjs/cognitive-complexity
export const mixRanges = (ranges: IRange[], newRange: IRange): IRange[] => {
  const result: IRange[] = [];
  let added = false;

  for (const range of ranges) {
    if (!added && range[0] === newRange[0] && newRange[1] === range[1]) {
      added = true;
    } else if (!added && newRange[0] > range[0] && newRange[1] < range[1]) {
      result.push([range[0], newRange[0] - 1]);
      result.push([newRange[1] + 1, range[1]]);
      added = true;
    } else if (!added && newRange[0] <= range[1] && newRange[1] >= range[0]) {
      if (newRange[0] > range[0]) {
        result.push([range[0], newRange[0] - 1]);
      }
      if (newRange[1] < range[1]) {
        result.push([newRange[1] + 1, range[1]]);
      }
      added = true;
    } else {
      result.push([...range]);
    }
  }

  if (!added) {
    result.push(newRange);
  }
  return serializedRanges(result);
};

export const calculateMaxRange = (selection: CombinedSelection) => {
  const { isCellSelection, ranges } = selection;
  if (isCellSelection) {
    const [startColIndex, startRowIndex] = ranges[0];
    const [endColIndex, endRowIndex] = ranges[1];
    return [Math.max(startColIndex, endColIndex), Math.max(startRowIndex, endRowIndex)];
  }
  return null;
};

export const checkIfRowOrCellActive = (
  activeCell: ICellItem | null,
  rowIndex: number,
  columnIndex: number
) => {
  if (activeCell == null) {
    return {
      isRowActive: false,
      isCellActive: false,
    };
  }
  const [activeColumnIndex, activeRowIndex] = activeCell;
  return {
    isRowActive: activeRowIndex === rowIndex,
    isCellActive: activeRowIndex === rowIndex && activeColumnIndex === columnIndex,
  };
};

export const checkIfRowOrCellSelected = (
  selection: CombinedSelection,
  rowIndex: number,
  columnIndex: number
) => {
  const { isRowSelection, isCellSelection } = selection;
  if (isRowSelection && selection.includes([rowIndex, rowIndex])) {
    return {
      isRowSelected: true,
      isCellSelected: true,
    };
  }
  if (isCellSelection && selection.includes([columnIndex, rowIndex])) {
    return {
      isRowSelected: false,
      isCellSelected: true,
    };
  }
  return {
    isRowSelected: false,
    isCellSelected: false,
  };
};
