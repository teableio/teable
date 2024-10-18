import type { IWorksheetData, ICellData } from '@univerjs/core';
import { cloneDeep, has, isObject } from 'lodash';

// to compatible with previous
const exactCountPattern = /^\{\{([^:{}]+):([^{}]+)\}\}$/;
const templateValueReg = /^\{\{[^}]*\}\}$/;

export const clearTemplateMarker = (sheetData?: IWorksheetData['cellData']) => {
  if (!sheetData) {
    return sheetData;
  }

  const newSheetData = cloneDeep(sheetData);

  for (const key in newSheetData) {
    if (has(newSheetData, key)) {
      for (const key2 in newSheetData[key]) {
        const cellValue = newSheetData[key][key2].v ?? '';
        // new way to recognize template value
        const customer = newSheetData[key][key2].custom;
        if (
          (has(newSheetData[key], key2) && exactCountPattern.test(String(cellValue))) ||
          (isObject(customer) && has(customer, 'fieldId'))
        ) {
          newSheetData[key][key2].v = undefined;
        }
      }
    }
  }

  return newSheetData;
};

export const clearChangedTemplateValue = (sheetData?: IWorksheetData['cellData']) => {
  if (!sheetData) {
    return {
      cellData: sheetData,
      deletedFields: [] as string[],
    };
  }

  const newSheetData = cloneDeep(sheetData);
  const deletedFields = [];

  for (const key in newSheetData) {
    if (has(newSheetData, key)) {
      for (const key2 in newSheetData[key]) {
        const cellValue = newSheetData[key][key2].v ?? '';
        if (
          (has(newSheetData[key], key2) &&
            !templateValueReg.test(String(cellValue)) &&
            Boolean(newSheetData[key][key2]?.custom?.fieldId)) ||
          !exactCountPattern.test(String(cellValue))
        ) {
          deletedFields.push(newSheetData[key][key2]?.custom?.fieldId as string);
          delete newSheetData[key][key2].custom;
        }
      }
    }
  }

  return {
    cellData: newSheetData,
    deletedFields: deletedFields as string[],
  };
};

export const getRecordRangesMap = (sheetData?: IWorksheetData['cellData']) => {
  const rangesMap: Record<string, [number, number]> = {};

  if (!sheetData) {
    return rangesMap;
  }

  const processCell = (key: string, key2: string, cell: ICellData) => {
    const { v: cellValue } = cell;
    const match = typeof cellValue === 'string' ? cellValue.match(exactCountPattern) : null;

    if (match) {
      const fieldId = match[2];
      rangesMap[fieldId] = [parseInt(key), parseInt(key2)];
    }

    if (cell.custom?.fieldId) {
      const fieldId = cell.custom.fieldId;
      rangesMap[fieldId] = [parseInt(key), parseInt(key2)];
    }
  };

  for (const [key, row] of Object.entries(sheetData)) {
    if (isObject(row)) {
      for (const [key2, cell] of Object.entries(row)) {
        if (isObject(cell)) {
          processCell(key, key2, cell);
        }
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
