import { ApiPropertyOptional } from '@nestjs/swagger';
import type { IRecordsRo } from '@teable-group/core';
import { Transform, Type } from 'class-transformer';
import { IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { RecordRo } from './record.ro';

const defaultPageSize = 100;
const maxPageSize = 10000;

export class RecordsRo extends RecordRo implements IRecordsRo {
  @ApiPropertyOptional({
    type: Number,
    example: defaultPageSize,
    default: defaultPageSize,
    maximum: maxPageSize,
    minimum: 1,
    description: 'The record count you want to take',
  })
  @Type(() => Number)
  @IsOptional()
  @Min(1, { message: 'You should at least take 1 record' })
  @Max(maxPageSize, {
    message: `Can't take more than ${maxPageSize} records, please reduce take count`,
  })
  take: number = defaultPageSize;

  @ApiPropertyOptional({
    type: Number,
    example: 0,
    default: 0,
    minimum: 0,
    description: 'The records count you want to skip',
  })
  @Type(() => Number)
  @IsOptional()
  @Min(0, { message: 'You can not skip a negative count of records' })
  skip = 0;

  @ApiPropertyOptional({
    type: [String],
    example: 'recXXXXXXX',
    description: 'Specify the records you want to fetch',
  })
  @IsOptional()
  @Transform((param) => (param.value as string).split(','), { toClassOnly: true })
  @ValidateIf(
    (o) => {
      return o.recordIds ? o.recordIds.every((r: string) => r.startsWith('rec')) : true;
    },
    {
      message: 'Error recordIds, recordId is illegal',
    }
  )
  recordIds?: string[];

  @ApiPropertyOptional({
    type: String,
    example: 'viwXXXXXXX',
    description:
      'Set the view you want to fetch, default is first view. result will influent by view options.',
  })
  viewId?: string;
}
