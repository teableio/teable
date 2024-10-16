import type { IWorksheetData, ICellData } from '@univerjs/core';
import { cloneDeep, has, isObject } from 'lodash';

const exactCountPattern = /^\{\{([^:{}]+):([^{}]+)\}\}$/;

export const clearTemplateMarker = (sheetData?: IWorksheetData['cellData']) => {
  if (!sheetData) {
    return sheetData;
  }

  const newSheetData = cloneDeep(sheetData);

  for (const key in newSheetData) {
    if (has(newSheetData, key)) {
      for (const key2 in newSheetData[key]) {
        const cellValue = newSheetData[key][key2].v ?? '';
        if (has(newSheetData[key], key2) && exactCountPattern.test(String(cellValue))) {
          delete newSheetData[key][key2];
        }
      }
    }
  }

  return newSheetData;
};

export const getRecordRangesMap = (sheetData?: IWorksheetData['cellData']) => {
  const rangesMap: Record<string, [number, number]> = {};

  if (!sheetData) {
    return rangesMap;
  }

  for (const [key, row] of Object.entries(sheetData)) {
    if (!isObject(row)) {
      continue;
    }
    for (const [key2, cell] of Object.entries(row)) {
      if (!isObject(cell)) {
        continue;
      }
      const { v: cellValue } = cell as ICellData;
      const match = typeof cellValue === 'string' ? cellValue?.match(exactCountPattern) : null;
      if (match) {
        const fieldId = match[2];
        rangesMap[fieldId] = [parseInt(key), parseInt(key2)];
      }
    }
  }

  return rangesMap;
};

export const getLetterCoordinateByRange = (range: [number, number]) => {
  const [row, col] = range;

  return `${numberCoordinate2Letter(col + 1)}${row + 1}`;
};

export const numberCoordinate2Letter = (n: number) => {
  let result = '';
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode((n % 26) + 'A'.charCodeAt(0)) + result;
    n = Math.floor(n / 26);
  }
  return result;
};
