import { DateFieldCore } from '@teable/core';
import type { FieldBase } from '../field-base';

export class DateFieldDto extends DateFieldCore implements FieldBase {
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
      if (value == null) return value;
      const arr: unknown[] =
        typeof value === 'object' ? (value as unknown[]) : JSON.parse(value as string);
      return arr.map((v) => {
        if (v instanceof Date) return v.toISOString();
        if (typeof v === 'string' || typeof v === 'number') return new Date(v).toISOString();
        return v as unknown;
      });
    }
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value).toISOString();
    }

    return value;
  }
}
