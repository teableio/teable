import type { CellValueType, FieldType } from '@teable/core';

/** Storage metadata needed to build indexes; accepts existing field DTOs structurally. */
export interface ITableIndexField {
  readonly id: string;
  readonly type: FieldType;
  readonly dbFieldName: string;
  readonly cellValueType: CellValueType;
  readonly options?: unknown;
  readonly isMultipleCellValue?: boolean;
  readonly isStructuredCellValue: boolean;
}
