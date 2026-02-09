import { LastModifiedTimeFieldCore } from '@teable/core';
import type { IFormulaFieldMeta } from '@teable/core';
import type { FieldBase } from '../field-base';

export class LastModifiedTimeFieldDto extends LastModifiedTimeFieldCore implements FieldBase {
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
    const normalizeDateValue = (input: unknown) => {
      if (input instanceof Date) {
        return input.toISOString();
      }
      if (typeof input === 'string') {
        const hasTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(input);
        const parsed = new Date(hasTimezone ? input : `${input}Z`);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      }
      return input;
    };

    if (this.isMultipleCellValue) {
      if (value == null) return value;
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeDateValue);
      }
      return parsed;
    }

    return normalizeDateValue(value);
  }

  setMetadata(meta: IFormulaFieldMeta) {
    this.meta = meta;
  }
}
