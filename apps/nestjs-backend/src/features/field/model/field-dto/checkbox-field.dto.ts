import type { IFieldRo, ILookupOptionsVo } from '@teable-group/core';
import { CellValueType, DbFieldType, Relationship, CheckboxFieldCore } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { IFieldBase } from '../field-base';

export class CheckboxFieldDto extends CheckboxFieldCore implements IFieldBase {
  static factory(fieldRo: IFieldRo) {
    const isLookup = fieldRo.isLookup;
    const isMultipleCellValue =
      fieldRo.lookupOptions &&
      (fieldRo.lookupOptions as ILookupOptionsVo).relationship !== Relationship.ManyOne;

    return plainToInstance(CheckboxFieldDto, {
      ...fieldRo,
      options: fieldRo.options ?? this.defaultOptions(),
      isComputed: isLookup,
      cellValueType: CellValueType.Boolean,
      dbFieldType: isMultipleCellValue ? DbFieldType.Json : DbFieldType.Integer,
      isMultipleCellValue,
    } as CheckboxFieldDto);
  }

  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return JSON.stringify(value);
    }
    return value ? 1 : null;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value && JSON.parse(value as string);
    }
    return value ? true : null;
  }
}
