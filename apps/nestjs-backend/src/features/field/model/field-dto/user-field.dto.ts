import type { IUserCellValue } from '@teable/core';
import { UserFieldCore } from '@teable/core';
import { UploadType } from '@teable/openapi';
import { omit } from 'lodash';
import { getFullStorageUrl } from '../../../../utils/full-storage-url';
import StorageAdapter from '../../../attachments/plugins/adapter';
import type { IFieldBase } from '../field-base';

export class UserFieldDto extends UserFieldCore implements IFieldBase {
  isStructuredCellValue = true;

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
    return this.applyTransformation<IUserCellValue>(parsedValue, this.fullAvatarUrl);
  }

  private fullAvatarUrl(cellValue: IUserCellValue) {
    if (cellValue?.id) {
      const bucket = StorageAdapter.getBucket(UploadType.Avatar);
      const path = `${StorageAdapter.getDir(UploadType.Avatar)}/${cellValue.id}`;

      cellValue.avatarUrl = getFullStorageUrl(`${bucket}/${path}`);
    }
    return cellValue;
  }

  private applyTransformation<T>(value: T | T[], transform: (item: T) => void): T | T[] {
    if (Array.isArray(value)) {
      value.forEach(transform);
    } else {
      transform(value);
    }
    return value;
  }
}
