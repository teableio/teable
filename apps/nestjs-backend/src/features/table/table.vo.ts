import { ApiProperty } from '@nestjs/swagger';
import type { ITableVo } from '@teable-group/core';
import { CreateTableRo } from './create-table.ro';

export class TableVo extends CreateTableRo implements ITableVo {
  @ApiProperty({
    description: 'The id of table.',
    example: 'tblxxxxxxx',
  })
  id!: string;

  @ApiProperty({
    description: 'The order of the table.',
  })
  order!: number;
}
