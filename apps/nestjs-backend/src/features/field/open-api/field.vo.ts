import { ApiProperty } from '@nestjs/swagger';
import type { IFieldBase } from '@teable-group/core';
import { CreateFieldDto } from '../create-field.dto';

export class FieldVo extends CreateFieldDto implements IFieldBase {
  @ApiProperty({
    description: 'The id of the field.',
    example: 'fldXXXXXXXX',
  })
  id!: string;
}
