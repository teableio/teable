import { ApiProperty } from '@nestjs/swagger';
import { DateFieldCore } from '@teable-group/core';
import type { IDateFieldOptions } from '@teable-group/core';
import type { IFieldBase } from '../field-base';
import { DatetimeFormattingDto } from '../formatting.dto';

export class DateOptionsDto implements IDateFieldOptions {
  @ApiProperty({
    type: 'boolean',
    example: false,
    description:
      'Whether the new row is automatically filled with the current time, caveat: the autoFill is just a formatter, it dose not effect the storing value of the record',
  })
  autoFill!: boolean;

  @ApiProperty({
    type: DatetimeFormattingDto,
  })
  formatting!: DatetimeFormattingDto;
}

export class DateFieldDto extends DateFieldCore implements IFieldBase {
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
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  }
}
