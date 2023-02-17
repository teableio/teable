import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { IFieldVo } from '@teable-group/core';
import { CellValueType, FieldType, DbFieldType } from '@teable-group/core';
import { CreateFieldRo } from './create-field.ro';

export class FieldVo extends CreateFieldRo implements IFieldVo {
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

  @ApiPropertyOptional({
    description: `true if this field is computed, false otherwise. A field is "computed" if it's value is not set by user input (e.g. autoNumber, formula, etc.).`,
    example: false,
  })
  isComputed?: boolean;

  @ApiProperty({
    description: `The real field type in database.`,
    example: false,
  })
  dbFieldType!: DbFieldType;
}
