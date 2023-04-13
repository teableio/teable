import { ApiProperty } from '@nestjs/swagger';
import type { IRecord } from '@teable-group/core';

export class RecordVo {
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
  })
  record!: {
    id: string;
    fields: { [fieldIdOrName: string]: unknown };
  };
}

export class RecordsVo {
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
  })
  records!: IRecord[];

  @ApiProperty({
    description: 'Total number of records in this query.',
  })
  total!: number;
}
