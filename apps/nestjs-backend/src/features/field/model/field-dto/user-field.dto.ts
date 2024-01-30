import { UserFieldCore } from '@teable/core';
import type { IFieldBase } from '../field-base';

export class UserFieldDto extends UserFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    return value && JSON.stringify(value);
  }

  convertDBValue2CellValue(value: unknown): unknown {
    return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
  }
}
