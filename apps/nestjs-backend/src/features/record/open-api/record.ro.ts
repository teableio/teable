import { ApiPropertyOptional } from '@nestjs/swagger';
import type { IRecordRo } from '@teable-group/core';
import { CellFormat, FieldKeyType } from '@teable-group/core';
import { IsEnum } from 'class-validator';

export class RecordRo implements IRecordRo {
  @ApiPropertyOptional({
    type: Object,
    description: 'Project the fields you want to fetch, default is all fields in view.',
  })
  projection?: { [fieldNameOrId: string]: boolean };

  @ApiPropertyOptional({
    enum: CellFormat,
    description: 'value formate, you can set it to text if you only need simple string value',
    default: CellFormat.Json,
  })
  @IsEnum(CellFormat, { message: 'Error cellFormate, You should set it to "json" or "text"' })
  cellFormat?: CellFormat = CellFormat.Json;

  @ApiPropertyOptional({
    enum: FieldKeyType,
    description: 'Set the key of record.fields[fieldNameOrId], default is "name"',
    default: FieldKeyType.Name,
  })
  @IsEnum(FieldKeyType, { message: 'Error fieldKeyType, You should set it to "name" or "id"' })
  fieldKeyType?: FieldKeyType = FieldKeyType.Name;
}
