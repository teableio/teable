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
      const arr: unknown[] = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? (JSON.parse(value) as unknown[])
          : (value as unknown[]);
      return arr.map((v) => {
        if (v instanceof Date) return v.toISOString();
        if (typeof v === 'number' || typeof v === 'string') {
          const parsed = new Date(v);
          return isNaN(parsed.getTime()) ? v : parsed.toISOString();
        }
        return v as unknown;
      });
    }
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? value : parsed.toISOString();
    }

    return value;
  }
}
