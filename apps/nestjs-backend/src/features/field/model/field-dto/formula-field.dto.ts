import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { FormulaFieldCore } from '@teable-group/core';
import type { IFormulaFieldOptions } from '@teable-group/core';
import type { IFieldBase } from '../field-base';
import {
  CurrencyFormattingDto,
  DatetimeFormattingDto,
  DecimalFormattingDto,
  PercentFormattingDto,
} from '../formatting.dto';
import { MultiNumberShowAsDto, SingleNumberShowAsDto } from '../show-as.dto';

@ApiExtraModels(DatetimeFormattingDto)
@ApiExtraModels(DecimalFormattingDto)
@ApiExtraModels(PercentFormattingDto)
@ApiExtraModels(CurrencyFormattingDto)
export class FormulaOptionsDto implements IFormulaFieldOptions {
  @ApiProperty({
    description: 'formula expression string',
  })
  expression!: string;

  @ApiPropertyOptional({
    description: 'perform different formatting processes according to different formatting types',
    oneOf: [
      { $ref: getSchemaPath(DecimalFormattingDto) },
      { $ref: getSchemaPath(PercentFormattingDto) },
      { $ref: getSchemaPath(CurrencyFormattingDto) },
    ],
  })
  formatting?: DecimalFormattingDto;

  @ApiPropertyOptional({
    description: 'show as options for the result of the formula',
    oneOf: [
      { $ref: getSchemaPath(SingleNumberShowAsDto) },
      { $ref: getSchemaPath(MultiNumberShowAsDto) },
    ],
  })
  showAs?: SingleNumberShowAsDto;
}

export class FormulaFieldDto extends FormulaFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null ? value : JSON.stringify(value);
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null ? value : JSON.parse(value as string);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  }
}
