import { DateFieldCore } from '@teable/core';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { FieldBase } from '../field-base';

dayjs.extend(utc);
dayjs.extend(timezone);

export class DateFieldDto extends DateFieldCore implements FieldBase {
  get isStructuredCellValue() {
    return false;
  }

  private toIsoString(value: string | number): string {
    const tz = this.options?.formatting?.timeZone;
    const parsed = dayjs(value);
    if (parsed.isValid()) {
      return parsed.toISOString();
    }
    if (tz) {
      const tzParsed = dayjs.tz(value, tz);
      if (tzParsed.isValid()) {
        return tzParsed.toISOString();
      }
    }
    return new Date(value).toISOString();
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
        if (typeof v === 'string' || typeof v === 'number') return this.toIsoString(v);
        return v as unknown;
      });
    }
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return this.toIsoString(value);
    }

    return value;
  }
}
