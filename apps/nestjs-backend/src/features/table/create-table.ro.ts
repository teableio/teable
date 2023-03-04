import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ICreateTableRo } from '@teable-group/core';

export class CreateTableRo implements ICreateTableRo {
  @ApiProperty({
    description: 'The name of table.',
    example: 'table1',
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'The description of table.',
    example: 'table1',
  })
  description?: string;
}
