import { ApiProperty } from '@nestjs/swagger';

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
  records!: {
    id: string;
    fields: { [fieldIdOrName: string]: unknown };
    createdTime: string;
    lastModifiedTime: string;
  }[];

  @ApiProperty({
    description: 'Total number of records in this query.',
  })
  total!: number;
}
