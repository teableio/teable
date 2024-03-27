import { MultipleSelectFieldCore } from '@teable/core';
import type { IFieldBase } from '../field-base';

export class MultipleSelectFieldDto extends MultipleSelectFieldCore implements IFieldBase {
  isStructuredCellValue = false;

  convertCellValue2DBValue(value: unknown): string | null {
    return value == null ? null : JSON.stringify(value);
  }

  convertDBValue2CellValue(value: unknown): string[] {
    return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
  }
}
