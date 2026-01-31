import { NumberFieldCore, parseStringToNumber } from '@teable/core';
import type { FieldBase } from '../field-base';

export class NumberFieldDto extends NumberFieldCore implements FieldBase {
  get isStructuredCellValue() {
    return false;
  }

  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null ? value : JSON.stringify(value);
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      const parsed =
        value == null || typeof value === 'object' ? value : JSON.parse(value as string);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => this.coerceNumber(item));
      }
      return parsed;
    }
    return this.coerceNumber(value);
  }

  private coerceNumber(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value;
    }
    const parsed = parseStringToNumber(value, this.options.formatting);
    return parsed ?? value;
  }
}
