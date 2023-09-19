import { CheckboxFieldCore } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

export class CheckboxFieldDto extends CheckboxFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return JSON.stringify(value);
    }
    return value ? true : null;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value && JSON.parse(value as string);
    }
    return value ? true : null;
  }
}
