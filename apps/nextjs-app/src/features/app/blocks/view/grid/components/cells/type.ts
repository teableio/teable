import type { CustomCell } from '@glideapps/glide-data-grid';
import type { FieldType, SelectFieldOptions } from '@teable-group/core';

export type IGridCell = ISingleSelectGridCell;

export interface ISingleSelectGridCell {
  type: FieldType.SingleSelect;
  value: string[];
  options: SelectFieldOptions;
}

export type ICustomCellGridCell = CustomCell<IGridCell>;
