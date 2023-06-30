import { ApiProperty } from '@nestjs/swagger';
import { CellValueType, DbFieldType, NumberFieldCore, Relationship } from '@teable-group/core';
import type { NumberFieldOptions } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { CreateFieldRo } from '../create-field.ro';
import type { IFieldBase } from '../field-base';

export class NumberOptionsDto implements NumberFieldOptions {
  @ApiProperty({
    type: Number,
    example: 2,
    description:
      'the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  precision!: number;
}

export class NumberFieldDto extends NumberFieldCore implements IFieldBase {
  static factory(fieldRo: CreateFieldRo) {
    const isLookup = fieldRo.isLookup;
    const isMultipleCellValue =
      fieldRo.lookupOptions && fieldRo.lookupOptions.relationship !== Relationship.ManyOne;

    return plainToInstance(NumberFieldDto, {
      ...fieldRo,
      isComputed: isLookup,
      cellValueType: CellValueType.Number,
      dbFieldType: isMultipleCellValue ? DbFieldType.Text : DbFieldType.Real,
      isMultipleCellValue,
    } as NumberFieldDto);
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
