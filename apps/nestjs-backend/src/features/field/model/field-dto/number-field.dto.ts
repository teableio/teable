import { NumberFieldCore } from '@teable/core';
import type { FieldBase } from '../field-base';

export class NumberFieldDto extends NumberFieldCore implements FieldBase {
  get isStructuredCellValue() {
    return false;
  }

  private roundToPrecision(value: number) {
    const precision = this.options?.formatting?.precision;
    if (typeof precision !== 'number') {
      return value;
    }
    // Use toFixed to avoid binary floating errors, then convert back
    return Number(value.toFixed(precision));
  }

  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null ? value : JSON.stringify(value);
    }
    if (typeof value === 'number') {
      return this.roundToPrecision(value);
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
    }
    return value;
  }
}
