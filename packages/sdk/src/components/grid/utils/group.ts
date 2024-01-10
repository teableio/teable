import type { IGroupPoint } from '../interface';

export interface IGroupIndexCollection {
  value: unknown;
  startIndex: number;
  cumulativeCount: number;
}

export const createGroupIndexCollections = (data: IGroupPoint[]): IGroupIndexCollection[] => {
  let cumulativeCount = 0;
  const groupIndexCollections: IGroupIndexCollection[] = [];

  data.forEach((item, index) => {
    const { type } = item;
    if (type === 0) {
      groupIndexCollections.push({ startIndex: index, cumulativeCount, value: item.value });
    } else if (type === 1) {
      cumulativeCount += item.count ?? 1;
    }
  });

  return groupIndexCollections;
};

export const binarySearchIndexPoint = (
  indexPoints: IGroupIndexCollection[],
  targetIndex: number
): IGroupIndexCollection | null => {
  let low = 0;
  let high = indexPoints.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midPoint = indexPoints[mid];

    if (midPoint.startIndex === targetIndex) {
      return midPoint;
    } else if (midPoint.startIndex < targetIndex) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return high >= 0 ? indexPoints[high] : null;
};

export const getInfoByGroupIndexCollections = (
  groupIndexCollections: IGroupIndexCollection[],
  targetIndex: number
) => {
  const groupIndexCollection = binarySearchIndexPoint(groupIndexCollections, targetIndex);

  if (!groupIndexCollection) {
    return {
      value: null,
      index: -1,
    };
  }

  const { value, startIndex, cumulativeCount } = groupIndexCollection;
  const rowsAfterGroupStart = targetIndex - startIndex - 1;
  const realRowIndex = cumulativeCount + rowsAfterGroupStart;

  return {
    value,
    index: realRowIndex,
  };
};

// const indexPoints = createIndexPoints(data);

// const indexToFind = 3;
// const [groupHeadValue, realRowIndex] = getInfoByIndex(data, indexPoints, indexToFind);
// console.log(`Group Head Value: ${groupHeadValue}, Real Row Index: ${realRowIndex}`);
