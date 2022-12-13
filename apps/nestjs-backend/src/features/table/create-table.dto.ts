import { ApiProperty } from '@nestjs/swagger';

export class CreateTableDto {
  @ApiProperty({
    description: 'the name of table',
    example: 'table1',
  })
  name!: string;
}
