import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { IDatetimeFormatting, INumberFormatting } from '@teable-group/core';
import { DateFormattingPreset, TimeFormatting } from '@teable-group/core';

export class NumberFormattingDto implements INumberFormatting {
  @ApiProperty({
    type: Number,
    example: 2,
    description:
      'the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  precision!: number;
}

export class DatetimeFormattingDto implements IDatetimeFormatting {
  @ApiPropertyOptional({
    type: 'string',
    example: 'America/Los_Angeles',
    description:
      'the display time zone of the time, caveat: the timeZone is just a formatter, it dose not effect the storing value of the record',
  })
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone;

  @ApiPropertyOptional({
    type: 'string',
    example: DateFormattingPreset.US,
    description:
      'the display formatting of the date, caveat: the formatting is just a formatter, it dose not effect the storing value of the record',
  })
  date: string = DateFormattingPreset.US;

  @ApiPropertyOptional({
    enum: TimeFormatting,
    example: TimeFormatting.Hour24,
    description:
      'the display formatting of the time, caveat: the formatting is just a formatter, it dose not effect the storing value of the record',
  })
  time: TimeFormatting = TimeFormatting.None;
}
