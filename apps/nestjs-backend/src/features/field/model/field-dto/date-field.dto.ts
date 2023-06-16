import { ApiProperty } from '@nestjs/swagger';
import { DateFormatting, DateFieldCore } from '@teable-group/core';
import type { DateFieldOptions } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

export class DateOptionsDto implements DateFieldOptions {
  @ApiProperty({
    enum: DateFormatting,
    example: DateFormatting.YMDForIncline,
    description:
      'the display formatting of the date, caveat: the formatting is just a formatter, it dose not effect the storing value of the record',
  })
  formatting!: DateFormatting;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      'Whether the new row is automatically filled with the current time, caveat: the autoFill is just a formatter, it dose not effect the storing value of the record',
  })
  autoFill!: boolean;
}

export class DateFieldDto extends DateFieldCore implements IFieldBase {
  convertCellValue2DBValue(value: unknown): unknown {
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    return value;
  }
}
