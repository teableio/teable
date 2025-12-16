import { DateFieldCore } from '@teable/core';
import type { FieldBase } from '../field-base';

const ISO_DATETIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

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

  private convertDateStringToIso(value: string): string | null {
    if (!value) return null;

    if (ISO_DATETIME_WITH_OFFSET.test(value)) {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    const converted = this.convertStringToCellValue(value);
    if (converted) {
      return converted;
    }

    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
        if (typeof v === 'number') return new Date(v).toISOString();
        if (typeof v === 'string') return this.convertDateStringToIso(v) ?? v;
        return v as unknown;
      });
    }
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'string') {
      return this.convertDateStringToIso(value) ?? value;
    }

    if (typeof value === 'number') {
      return new Date(value).toISOString();
    }

    return value;
  }
}
