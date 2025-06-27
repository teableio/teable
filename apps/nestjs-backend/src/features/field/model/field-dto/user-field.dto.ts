import type { IUserCellValue } from '@teable/core';
import { UserFieldCore } from '@teable/core';
import { UploadType } from '@teable/openapi';
import { omit } from 'lodash';
import StorageAdapter from '../../../attachments/plugins/adapter';
import { getPublicFullStorageUrl } from '../../../attachments/plugins/utils';
import type { FieldBase } from '../field-base';

export class UserFieldDto extends UserFieldCore implements FieldBase {
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

  static fullAvatarUrl(cellValue: IUserCellValue) {
    if (cellValue?.id) {
      const path = `${StorageAdapter.getDir(UploadType.Avatar)}/${cellValue.id}`;

      cellValue.avatarUrl = getPublicFullStorageUrl(path);
    }
    return cellValue;
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
