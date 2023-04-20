import type { FieldType, SingleSelectFieldOptions } from '@teable-group/core';

export type IGridCell = ISingleSelectGridCell;

export interface ISingleSelectGridCell {
  type: FieldType.SingleSelect;
  value: string[];
  options: SingleSelectFieldOptions;
}
