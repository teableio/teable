import type { IFieldRo } from '@teable-group/core';
import { AttachmentFieldCore, CellValueType, DbFieldType } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { IFieldBase } from '../field-base';

export class AttachmentFieldDto extends AttachmentFieldCore implements IFieldBase {
  static factory(fieldRo: IFieldRo) {
    const isLookup = fieldRo.isLookup;

    return plainToInstance(AttachmentFieldDto, {
      ...fieldRo,
      options: fieldRo.options ?? this.defaultOptions(),
      isComputed: isLookup,
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
      dbFieldType: DbFieldType.Json,
    } as AttachmentFieldDto);
  }

  convertCellValue2DBValue(value: unknown): unknown {
    return value && JSON.stringify(value);
  }

  convertDBValue2CellValue(value: string): unknown {
    return value && JSON.parse(value);
  }
}
