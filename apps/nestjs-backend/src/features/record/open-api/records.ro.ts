import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { IRecordsRo } from '@teable-group/core';
import { CellFormat, FieldKeyType, IFilter } from '@teable-group/core';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsOptional, Max, Min, ValidateIf } from 'class-validator';

const defaultPageSize = 100;
const maxPageSize = 10000;

export class RecordsRo implements IRecordsRo {
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

  @ApiPropertyOptional({
    type: [String],
    description: 'Project the fields you want to fetch, default is all fields in view.',
  })
  projection?: string[];

  @ApiPropertyOptional({
    enum: CellFormat,
    description: 'value formate, you can set it to text if you only need simple string value',
    default: CellFormat.Json,
  })
  @IsEnum(CellFormat, { message: 'Error cellFormate, You should set it to "json" or "text"' })
  cellFormat?: CellFormat = CellFormat.Json;

  @ApiPropertyOptional({
    enum: FieldKeyType,
    description: 'Set the key of record.fields[key], default is "name"',
    default: FieldKeyType.Name,
  })
  @IsEnum(FieldKeyType, { message: 'Error fieldKey, You should set it to "name" or "id"' })
  fieldKey?: FieldKeyType = FieldKeyType.Name;

  @ApiHideProperty()
  @IsOptional()
  filter?: IFilter;

  @ApiPropertyOptional({
    description:
      'A Teable Query Language (TQL) string used to filter results. It allows complex query conditions based on fields, operators, and values.',
    example: "{field} = 'Completed' AND {field} > 5",
  })
  @IsOptional()
  filterByTql?: string;
}
