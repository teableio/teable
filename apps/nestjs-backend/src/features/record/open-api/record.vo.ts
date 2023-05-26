import { ApiHideProperty, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IRecordFields } from '@teable-group/core';
import type { IRecord, IRecordsVo, IRecordVo } from '@teable-group/core';

export class Record implements IRecord {
  @ApiProperty({
    description: 'The record id.',
  })
  id!: string;

  @ApiProperty({
    description: 'Objects with a fields key mapping fieldId or field name to value for that field.',
    type: Object,
  })
  fields!: IRecordFields;

  @ApiPropertyOptional({
    description: 'Created time, milliseconds timestamp.',
  })
  createdTime?: number;

  @ApiPropertyOptional({
    description: 'Last modified time, milliseconds timestamp.',
  })
  lastModifiedTime?: number;

  @ApiPropertyOptional({
    description: 'Created by, user name',
  })
  createdBy?: string;

  @ApiPropertyOptional({
    description: 'Last modified by, user name',
  })
  lastModifiedBy?: string;

  @ApiHideProperty()
  recordOrder!: { [viewId: string]: number };
}

export class RecordVo implements IRecordVo {
  @ApiProperty({
    description:
      'Array of objects with a fields key mapping fieldId or field name to value for that field.',
    example: [
      {
        id: 'recXXXXXXX',
        fields: {
          fldXXXXXXXXXXXXXXX: 'text value',
        },
      },
    ],
    type: Record,
  })
  record!: Record;
}

export class CreateRecordsVo implements Omit<IRecordsVo, 'total'> {
  @ApiProperty({
    description:
      'Array of objects with a fields key mapping fieldId or field name to value for that field.',
    example: [
      {
        id: 'recXXXXXXX',
        fields: {
          fldXXXXXXXXXXXXXXX: 'text value',
        },
      },
    ],
    isArray: true,
    type: Record,
  })
  records!: Record[];
}

export class RecordsVo extends CreateRecordsVo implements IRecordsVo {
  @ApiProperty({
    description: 'Total number of records in this query.',
  })
  total!: number;
}
