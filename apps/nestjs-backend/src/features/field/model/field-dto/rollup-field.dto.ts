import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { RollupFieldCore } from '@teable-group/core';
import type { IRollupFieldOptions } from '@teable-group/core';
import type { IFieldBase } from '../field-base';
import { DatetimeFormattingDto, NumberFormattingDto } from '../formatting.dto';
import { MultiNumberShowAsDto, SingleNumberShowAsDto } from '../show-as.dto';

@ApiExtraModels(DatetimeFormattingDto)
@ApiExtraModels(NumberFormattingDto)
export class RollupOptionsDto implements IRollupFieldOptions {
  @ApiProperty({
    description: 'formula expression string',
  })
  expression!: IRollupFieldOptions['expression'];

  @ApiPropertyOptional({
    description: 'formatting options for the result of the rollup',
    oneOf: [
      { $ref: getSchemaPath(NumberFormattingDto) },
      { $ref: getSchemaPath(DatetimeFormattingDto) },
    ],
  })
  formatting?: NumberFormattingDto;

  @ApiPropertyOptional({
    description: 'show as options for the result of the rollup',
    oneOf: [
      { $ref: getSchemaPath(SingleNumberShowAsDto) },
      { $ref: getSchemaPath(MultiNumberShowAsDto) },
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
