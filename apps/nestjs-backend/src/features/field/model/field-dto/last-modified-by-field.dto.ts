import type { IUserCellValue } from '@teable/core';
import { LastModifiedByFieldCore } from '@teable/core';
import { omit } from 'lodash';
import type { FieldBase } from '../field-base';
import { UserFieldDto } from './user-field.dto';

export class LastModifiedByFieldDto extends LastModifiedByFieldCore implements FieldBase {
  get isStructuredCellValue() {
    return true;
  }

  convertCellValue2DBValue(value: unknown): unknown {
    if (!value) {
      return null;
    }

    this.applyTransformation<IUserCellValue>(value as IUserCellValue | IUserCellValue[], (item) =>
      omit(item, ['avatarUrl'])
    );
    return JSON.stringify(value);
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (value === null) return null;

    const parsedValue: IUserCellValue | IUserCellValue[] =
      typeof value === 'string' ? JSON.parse(value) : value;
    return this.applyTransformation<IUserCellValue>(parsedValue, UserFieldDto.fullAvatarUrl);
  }

  applyTransformation<T>(value: T | T[], transform: (item: T) => void): T | T[] {
    if (Array.isArray(value)) {
      value.forEach(transform);
    } else {
      transform(value);
    }
    return value;
  }
}
