import { MultipleSelectFieldCore } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

export class MultipleSelectFieldDto extends MultipleSelectFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): string | null {
    return value == null ? null : JSON.stringify(value);
  }

  convertDBValue2CellValue(value: string): string[] {
    return value == null ? value : JSON.parse(value);
  }
}
