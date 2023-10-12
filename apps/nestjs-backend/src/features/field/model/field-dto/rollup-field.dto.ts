import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { RollupFieldCore } from '@teable-group/core';
import type { IRollupFieldOptions } from '@teable-group/core';
import type { IFieldBase } from '../field-base';
import {
  CurrencyFormattingDto,
  DatetimeFormattingDto,
  DecimalFormattingDto,
  PercentFormattingDto,
} from '../formatting.dto';
import {
  MultiNumberShowAsDto,
  SingleLineTextShowAsDto,
  SingleNumberShowAsDto,
} from '../show-as.dto';

@ApiExtraModels(DatetimeFormattingDto)
@ApiExtraModels(DecimalFormattingDto)
@ApiExtraModels(PercentFormattingDto)
@ApiExtraModels(CurrencyFormattingDto)
export class RollupOptionsDto implements IRollupFieldOptions {
  @ApiProperty({
    description: 'formula expression string',
  })
  expression!: IRollupFieldOptions['expression'];

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
    description: 'show as options for the result of the rollup',
    oneOf: [
      { $ref: getSchemaPath(SingleNumberShowAsDto) },
      { $ref: getSchemaPath(MultiNumberShowAsDto) },
      { $ref: getSchemaPath(SingleLineTextShowAsDto) },
    ],
  })
  showAs?: SingleNumberShowAsDto;
}

export class RollupFieldDto extends RollupFieldCore implements IFieldBase {
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
    return value;
  }
}
