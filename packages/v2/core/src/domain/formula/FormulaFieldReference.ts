import type { CellValueType } from './CellValueType';

export type FormulaFieldReference = {
  id: string;
  cellValueType: CellValueType;
  isMultipleCellValue: boolean;
};
