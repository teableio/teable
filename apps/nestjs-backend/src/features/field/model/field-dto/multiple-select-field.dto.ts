import { MultipleSelectFieldCore } from '@teable/core';
import type { FieldBase } from '../field-base';

export class MultipleSelectFieldDto extends MultipleSelectFieldCore implements FieldBase {
  get isStructuredCellValue() {
    return false;
  }

  convertCellValue2DBValue(value: unknown): string | null {
    return value == null ? null : JSON.stringify(value);
  }

  convertDBValue2CellValue(value: unknown): string[] {
    return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
  }
}
