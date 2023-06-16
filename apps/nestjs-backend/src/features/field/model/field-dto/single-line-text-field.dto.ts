import {
  CellValueType,
  DbFieldType,
  Relationship,
  SingleLineTextFieldCore,
} from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { CreateFieldRo } from '../create-field.ro';
import type { IFieldBase } from '../field-base';

export class SingleLineTextFieldDto extends SingleLineTextFieldCore implements IFieldBase {
  static factory(fieldRo: CreateFieldRo) {
    const isLookup = fieldRo.isLookup;
    const isMultipleCellValue =
      fieldRo.lookupOptions && fieldRo.lookupOptions.relationShip !== Relationship.ManyOne;

    return plainToInstance(SingleLineTextFieldDto, {
      ...fieldRo,
      isComputed: isLookup,
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
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
