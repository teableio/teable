import { ApiProperty } from '@nestjs/swagger';
import {
  DateFormatting,
  TimeFormatting,
  DateFieldCore,
  Relationship,
  CellValueType,
  DbFieldType,
  DEFAULT_TIME_ZONE,
} from '@teable-group/core';
import type { DateFieldOptions } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { CreateFieldRo } from '../create-field.ro';
import type { IFieldBase } from '../field-base';

export class DateOptionsDto implements DateFieldOptions {
  @ApiProperty({
    enum: DateFormatting,
    example: DateFormatting.YMDWithSlash,
    description:
      'the display formatting of the date, caveat: the formatting is just a formatter, it dose not effect the storing value of the record',
  })
  dateFormatting!: DateFormatting;

  @ApiProperty({
    enum: TimeFormatting,
    example: TimeFormatting.Hour24,
    description:
      'the display formatting of the time, caveat: the formatting is just a formatter, it dose not effect the storing value of the record',
  })
  timeFormatting!: TimeFormatting;

  @ApiProperty({
    type: 'string',
    example: DEFAULT_TIME_ZONE,
    description:
      'the display time zone of the time, caveat: the timeZone is just a formatter, it dose not effect the storing value of the record',
  })
  timeZone!: string;

  @ApiProperty({
    type: 'boolean',
    example: false,
    description:
      'Whether the new row is automatically filled with the current time, caveat: the autoFill is just a formatter, it dose not effect the storing value of the record',
  })
  autoFill!: boolean;
}

export class DateFieldDto extends DateFieldCore implements IFieldBase {
  static factory(fieldRo: CreateFieldRo) {
    const isLookup = fieldRo.isLookup;
    const isMultipleCellValue =
      fieldRo.lookupOptions && fieldRo.lookupOptions.relationship !== Relationship.ManyOne;

    return plainToInstance(DateFieldDto, {
      ...fieldRo,
      isComputed: isLookup,
      cellValueType: CellValueType.DateTime,
      dbFieldType: isMultipleCellValue ? DbFieldType.Text : DbFieldType.DateTime,
      isMultipleCellValue,
    } as DateFieldDto);
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
