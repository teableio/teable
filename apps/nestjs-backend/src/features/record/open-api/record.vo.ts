import { ApiProperty } from '@nestjs/swagger';
import type { IRecordsVo, IRecord } from '@teable-group/core';

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
  })
  records!: IRecord[];
}

export class RecordsVo extends CreateRecordsVo implements IRecordsVo {
  @ApiProperty({
    description: 'Total number of records in this query.',
  })
  total!: number;
}
