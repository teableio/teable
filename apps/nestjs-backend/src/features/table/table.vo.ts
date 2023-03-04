import { ApiProperty } from '@nestjs/swagger';
import { CreateTableRo } from './create-table.ro';

export class TableVo extends CreateTableRo {
  @ApiProperty({
    description: 'The id of table.',
    example: 'tblxxxxxxx',
  })
  id!: string;
}
