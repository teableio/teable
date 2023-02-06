import { ApiProperty } from '@nestjs/swagger';
import type { Field } from '@teable-group/core';
import { CellValueType, FieldType } from '@teable-group/core';
import { CreateFieldRo } from './create-field.ro';

export class FieldVo extends CreateFieldRo implements Field {
  @ApiProperty({
    description: 'The id of the field.',
    example: 'fldXXXXXXXX',
  })
  id!: string;

  @ApiProperty({
    description: 'The field type after calculated.',
    enum: FieldType,
    example: FieldType.SingleLineText,
  })
  calculatedType!: FieldType;

  @ApiProperty({
    description: 'The basic data type of cellValue.',
    enum: CellValueType,
    example: CellValueType.String,
  })
  cellValueType!: CellValueType;
}
