/* eslint-disable sonarjs/no-duplicate-string */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  ICurrencyFormatting,
  IDatetimeFormatting,
  IDecimalFormatting,
  IPercentFormatting,
} from '@teable-group/core';
import { DateFormattingPreset, NumberFormattingType, TimeFormatting } from '@teable-group/core';

export class DecimalFormattingDto implements IDecimalFormatting {
  @ApiProperty({
    enum: NumberFormattingType,
    example: NumberFormattingType.Decimal,
    description:
      'the formatting type of the number, caveat: the formatting type is just a formatter, it dose not effect the storing value of the record',
  })
  type!: NumberFormattingType.Decimal;

  @ApiProperty({
    type: Number,
    example: 2,
    description:
      'the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  precision!: number;
}

export class PercentFormattingDto implements IPercentFormatting {
  @ApiProperty({
    enum: NumberFormattingType,
    example: NumberFormattingType.Percent,
    description:
      'the formatting type of the number, caveat: the formatting type is just a formatter, it dose not effect the storing value of the record',
  })
  type!: NumberFormattingType.Percent;

  @ApiProperty({
    type: Number,
    example: 2,
    description:
      'the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  precision!: number;
}

export class CurrencyFormattingDto implements ICurrencyFormatting {
  @ApiProperty({
    enum: NumberFormattingType,
    example: NumberFormattingType.Currency,
    description:
      'the formatting type of the number, caveat: the formatting type is just a formatter, it dose not effect the storing value of the record',
  })
  type!: NumberFormattingType.Currency;

  @ApiProperty({
    type: Number,
    example: 2,
    description:
      'the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  precision!: number;

  @ApiProperty({
    type: String,
    example: '$',
    description:
      'the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record',
  })
  symbol!: string;
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
