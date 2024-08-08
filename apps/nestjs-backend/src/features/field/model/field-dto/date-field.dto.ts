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
      return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (value instanceof Object && 'toISOString' in value) {
      return (value as Date).toISOString();
    }

    console.warn('Unexpected data value: ', value);

    if (value instanceof Object) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.warn('data value __proto__: ', (value as any).__proto__);
      console.warn('data value constructor: ', value.constructor);
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value).toISOString();
    }

    return value;
  }
}
