import { ApiProperty } from '@nestjs/swagger';
import { CellValueType, DbFieldType, NumberFieldCore, Relationship } from '@teable-group/core';
import type { INumberFieldOptions } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { CreateFieldRo } from '../create-field.ro';
import type { IFieldBase } from '../field-base';
import { NumberFormattingDto } from './formatting.dto';

export class NumberOptionsDto implements INumberFieldOptions {
  @ApiProperty({
    type: NumberFormattingDto,
  })
  formatting!: NumberFormattingDto;
}

export class NumberFieldDto extends NumberFieldCore implements IFieldBase {
  static factory(fieldRo: CreateFieldRo) {
    const isLookup = fieldRo.isLookup;
    const isMultipleCellValue =
      fieldRo.lookupOptions && fieldRo.lookupOptions.relationship !== Relationship.ManyOne;

    return plainToInstance(NumberFieldDto, {
      ...fieldRo,
      options: fieldRo.options ?? this.defaultOptions(),
      isComputed: isLookup,
      cellValueType: CellValueType.Number,
      dbFieldType: isMultipleCellValue ? DbFieldType.Json : DbFieldType.Real,
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
