import type { IFieldRo, ILookupOptionsVo } from '@teable-group/core';
import {
  CellValueType,
  DbFieldType,
  Relationship,
  SingleLineTextFieldCore,
} from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { IFieldBase } from '../field-base';

export class SingleLineTextFieldDto extends SingleLineTextFieldCore implements IFieldBase {
  static factory(fieldRo: IFieldRo) {
    const isLookup = fieldRo.isLookup;
    const isMultipleCellValue =
      fieldRo.lookupOptions &&
      (fieldRo.lookupOptions as ILookupOptionsVo).relationship !== Relationship.ManyOne;

    return plainToInstance(SingleLineTextFieldDto, {
      ...fieldRo,
      options: fieldRo.options ?? this.defaultOptions(),
      isComputed: isLookup,
      cellValueType: CellValueType.String,
      dbFieldType: isMultipleCellValue ? DbFieldType.Json : DbFieldType.Text,
      isMultipleCellValue,
    } as SingleLineTextFieldDto);
  }

  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return JSON.stringify(value);
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value && JSON.parse(value as string);
    }
    return value;
  }
}
