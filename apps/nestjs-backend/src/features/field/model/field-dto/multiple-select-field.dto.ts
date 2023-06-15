import { CellValueType, DbFieldType, MultipleSelectFieldCore } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { CreateFieldRo } from '../create-field.ro';
import type { IFieldBase } from '../field-base';
import { SingleSelectOptionsDto } from './single-select-field.dto';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const MultipleSelectOptionsDto = SingleSelectOptionsDto;

export class MultipleSelectFieldDto extends MultipleSelectFieldCore implements IFieldBase {
  static factory(fieldRo: CreateFieldRo) {
    const isLookup = fieldRo.isLookup;

    return plainToInstance(MultipleSelectFieldDto, {
      ...fieldRo,
      isComputed: isLookup,
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
      dbFieldType: DbFieldType.Text,
    } as MultipleSelectFieldDto);
  }

  convertCellValue2DBValue(value: unknown): unknown {
    return value == null ? value : JSON.stringify(value);
  }

  convertDBValue2CellValue(value: string): unknown {
    return value == null ? value : JSON.parse(value);
  }
}
