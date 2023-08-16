import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { CellValueType, DbFieldType, NumberFieldCore, Relationship } from '@teable-group/core';
import type { INumberFieldOptions, ILookupOptionsVo, IFieldRo } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { IFieldBase } from '../field-base';
import { NumberFormattingDto } from './formatting.dto';
import { MultiNumberShowAsDto, SingleNumberShowAsDto } from './show-as.dto';

export class NumberOptionsDto implements INumberFieldOptions {
  @ApiProperty({
    type: NumberFormattingDto,
  })
  formatting!: NumberFormattingDto;

  @ApiPropertyOptional({
    description: 'show as options for the result of the number',
    oneOf: [
      { $ref: getSchemaPath(SingleNumberShowAsDto) },
      { $ref: getSchemaPath(MultiNumberShowAsDto) },
    ],
  })
  showAs?: SingleNumberShowAsDto;
}

export class NumberFieldDto extends NumberFieldCore implements IFieldBase {
  static factory(fieldRo: IFieldRo) {
    const isLookup = fieldRo.isLookup;
    const isMultipleCellValue =
      fieldRo.lookupOptions &&
      (fieldRo.lookupOptions as ILookupOptionsVo).relationship !== Relationship.ManyOne;

    return plainToInstance(NumberFieldDto, {
      ...fieldRo,
      name: fieldRo.name ?? 'Number',
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
