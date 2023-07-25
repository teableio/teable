import type { ICellItem, IRange, ISelectionState } from '../interface';
import { SelectionRegionType } from '../interface';

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

export const mergeRanges = (ranges: IRange[]): IRange[] => {
  if (ranges.length <= 1) {
    return ranges;
  }

  const mergedRanges: IRange[] = [];
  ranges.sort((a, b) => a[0] - b[0]);
  let currentRange: IRange = ranges[0];

  for (let i = 1; i < ranges.length; i++) {
    const nextRange = ranges[i];
    if (nextRange[0] <= currentRange[1] + 1) {
      currentRange[1] = Math.max(currentRange[1], nextRange[1]);
    } else {
      mergedRanges.push(currentRange);
      currentRange = nextRange;
    }
  }
  mergedRanges.push(currentRange);

  return mergedRanges;
};

// eslint-disable-next-line sonarjs/cognitive-complexity
export const mergeRowRanges = (ranges: IRange[], newRange: IRange): IRange[] => {
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
  return mergeRanges(result);
};

export const checkIfColumnActive = (selectionState: ISelectionState, columnIndex: number) => {
  const { type: regionType, ranges } = selectionState;
  if (regionType !== SelectionRegionType.Columns) return false;
  const range = ranges[0];
  return range[0] <= columnIndex && range[1] >= columnIndex;
};

export const checkIfRowSelected = (selectionState: ISelectionState, rowIndex: number) => {
  const { type: regionType, ranges } = selectionState;
  if (regionType === SelectionRegionType.Rows) {
    for (const range of ranges) {
      if (inRange(rowIndex, range[0], range[1])) {
        return true;
      }
    }
  }
  return false;
};

export const calculateMaxRange = (selectionState: ISelectionState) => {
  const { type: regionType, ranges } = selectionState;
  if (regionType === SelectionRegionType.Cells) {
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
  selectionState: ISelectionState,
  rowIndex: number,
  columnIndex: number
) => {
  const { type: regionType, ranges } = selectionState;
  if (regionType === SelectionRegionType.Rows) {
    for (const range of ranges) {
      if (inRange(rowIndex, range[0], range[1])) {
        return {
          isRowSelected: true,
          isCellSelected: true,
        };
      }
    }
  }
  if (regionType === SelectionRegionType.Cells) {
    const startRange = ranges[0];
    const endRange = ranges[1];
    return {
      isRowSelected: false,
      isCellSelected:
        inRange(rowIndex, startRange[1], endRange[1]) &&
        inRange(columnIndex, startRange[0], endRange[0]),
    };
  }
  return {
    isRowSelected: false,
    isCellSelected: false,
  };
};
