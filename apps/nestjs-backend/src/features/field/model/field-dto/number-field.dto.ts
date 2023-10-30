import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { NumberFieldCore } from '@teable-group/core';
import type { INumberFieldOptions } from '@teable-group/core';
import type { IFieldBase } from '../field-base';
import {
  CurrencyFormattingDto,
  DecimalFormattingDto,
  PercentFormattingDto,
} from '../formatting.dto';
import { MultiNumberShowAsDto, SingleNumberShowAsDto } from '../show-as.dto';

export class NumberOptionsDto implements INumberFieldOptions {
  @ApiProperty({
    description: 'perform different formatting processes according to different formatting types',
    oneOf: [
      { $ref: getSchemaPath(DecimalFormattingDto) },
      { $ref: getSchemaPath(PercentFormattingDto) },
      { $ref: getSchemaPath(CurrencyFormattingDto) },
    ],
  })
  formatting!: DecimalFormattingDto;

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
  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return JSON.stringify(value);
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
    }
    return value;
  }
}
